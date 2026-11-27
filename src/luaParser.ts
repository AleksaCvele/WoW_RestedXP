// Safe, dependency-free parser for World of Warcraft SavedVariables files.
//
// SavedVariables are plain Lua assignments of literal values:
//
//   RestedSyncDB = {
//     ["Thrall-Faerlina"] = {
//       ["level"] = 12,
//       ["isResting"] = true,
//     },
//   }
//
// This is a small recursive-descent parser for exactly that subset of Lua (literals,
// tables, comments). It never evaluates code, so a tampered file cannot run anything.

export type LuaValue = string | number | boolean | null | LuaTable;
export interface LuaTable {
  [key: string]: LuaValue;
}

export class LuaParseError extends Error {
  constructor(message: string, public readonly offset: number) {
    super(`${message} (at offset ${offset})`);
    this.name = "LuaParseError";
  }
}

const MAX_DEPTH = 64;
const MAX_INPUT_LENGTH = 32 * 1024 * 1024;

type Token =
  | { type: "string"; value: string; pos: number }
  | { type: "number"; value: number; pos: number }
  | { type: "name"; value: string; pos: number }
  | { type: "punct"; value: string; pos: number }
  | { type: "eof"; pos: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isHex(c: string): boolean {
  return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}
function isNameStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}
function isNameChar(c: string): boolean {
  return isNameStart(c) || isDigit(c);
}

class Lexer {
  private pos = 0;
  constructor(private readonly src: string) {}

  private error(message: string, at = this.pos): never {
    throw new LuaParseError(message, at);
  }

  /** Returns the level of a long bracket (`[[` = 0, `[==[` = 2) starting at pos, or -1. */
  private longBracketLevel(at: number): number {
    if (this.src[at] !== "[") return -1;
    let i = at + 1;
    let level = 0;
    while (this.src[i] === "=") {
      level++;
      i++;
    }
    return this.src[i] === "[" ? level : -1;
  }

  private readLongBracket(level: number): string {
    // pos is at the opening "["
    const start = this.pos + level + 2;
    const close = "]" + "=".repeat(level) + "]";
    const end = this.src.indexOf(close, start);
    if (end < 0) this.error("Unterminated long string or comment");
    let text = this.src.slice(start, end);
    // Lua skips a newline directly after the opening bracket.
    if (text.startsWith("\r\n")) text = text.slice(2);
    else if (text.startsWith("\n")) text = text.slice(1);
    this.pos = end + close.length;
    return text;
  }

  private skipWhitespaceAndComments(): void {
    const src = this.src;
    while (this.pos < src.length) {
      const c = src[this.pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v" || c === "﻿") {
        this.pos++;
        continue;
      }
      if (c === "-" && src[this.pos + 1] === "-") {
        this.pos += 2;
        const level = this.longBracketLevel(this.pos);
        if (level >= 0) {
          this.readLongBracket(level);
        } else {
          const nl = src.indexOf("\n", this.pos);
          this.pos = nl < 0 ? src.length : nl + 1;
        }
        continue;
      }
      break;
    }
  }

  private readQuotedString(quote: string): string {
    const src = this.src;
    const start = this.pos;
    this.pos++; // opening quote
    const bytes: number[] = [];
    let chunkStart = this.pos;
    const flush = (end: number) => {
      if (end > chunkStart) {
        for (const b of encoder.encode(src.slice(chunkStart, end))) bytes.push(b);
      }
    };
    while (true) {
      if (this.pos >= src.length) this.error("Unterminated string", start);
      const c = src[this.pos];
      if (c === quote) {
        flush(this.pos);
        this.pos++;
        break;
      }
      if (c === "\n") this.error("Unescaped newline in string", this.pos);
      if (c !== "\\") {
        this.pos++;
        continue;
      }
      flush(this.pos);
      this.pos++; // backslash
      const e = src[this.pos];
      switch (e) {
        case "n": bytes.push(10); this.pos++; break;
        case "t": bytes.push(9); this.pos++; break;
        case "r": bytes.push(13); this.pos++; break;
        case "a": bytes.push(7); this.pos++; break;
        case "b": bytes.push(8); this.pos++; break;
        case "f": bytes.push(12); this.pos++; break;
        case "v": bytes.push(11); this.pos++; break;
        case "\\": bytes.push(92); this.pos++; break;
        case '"': bytes.push(34); this.pos++; break;
        case "'": bytes.push(39); this.pos++; break;
        case "\n": bytes.push(10); this.pos++; break;
        case "\r":
          bytes.push(10);
          this.pos++;
          if (src[this.pos] === "\n") this.pos++;
          break;
        case "x": {
          const hex = src.slice(this.pos + 1, this.pos + 3);
          if (hex.length !== 2 || !isHex(hex[0]) || !isHex(hex[1])) this.error("Invalid \\x escape");
          bytes.push(parseInt(hex, 16));
          this.pos += 3;
          break;
        }
        case "z":
          this.pos++;
          while (this.pos < src.length && /\s/.test(src[this.pos])) this.pos++;
          break;
        default: {
          if (e !== undefined && isDigit(e)) {
            let digits = "";
            while (digits.length < 3 && isDigit(src[this.pos] ?? "")) {
              digits += src[this.pos];
              this.pos++;
            }
            const value = parseInt(digits, 10);
            if (value > 255) this.error("Decimal escape too large");
            bytes.push(value);
          } else {
            this.error(`Invalid escape sequence \\${e ?? ""}`);
          }
        }
      }
      chunkStart = this.pos;
    }
    return decoder.decode(new Uint8Array(bytes));
  }

  private readNumber(): number {
    const src = this.src;
    const start = this.pos;
    if (src[this.pos] === "0" && (src[this.pos + 1] === "x" || src[this.pos + 1] === "X")) {
      this.pos += 2;
      while (isHex(src[this.pos] ?? "")) this.pos++;
      const text = src.slice(start + 2, this.pos);
      if (!text) this.error("Malformed hex number", start);
      return parseInt(text, 16);
    }
    while (isDigit(src[this.pos] ?? "")) this.pos++;
    if (src[this.pos] === ".") {
      this.pos++;
      while (isDigit(src[this.pos] ?? "")) this.pos++;
    }
    if (src[this.pos] === "e" || src[this.pos] === "E") {
      this.pos++;
      if (src[this.pos] === "+" || src[this.pos] === "-") this.pos++;
      if (!isDigit(src[this.pos] ?? "")) this.error("Malformed number exponent", start);
      while (isDigit(src[this.pos] ?? "")) this.pos++;
    }
    const value = Number(src.slice(start, this.pos));
    if (Number.isNaN(value)) this.error("Malformed number", start);
    return value;
  }

  next(): Token {
    this.skipWhitespaceAndComments();
    const src = this.src;
    const pos = this.pos;
    if (pos >= src.length) return { type: "eof", pos };
    const c = src[pos];

    if (c === '"' || c === "'") return { type: "string", value: this.readQuotedString(c), pos };
    if (c === "[") {
      const level = this.longBracketLevel(pos);
      if (level >= 0) return { type: "string", value: this.readLongBracket(level), pos };
      this.pos++;
      return { type: "punct", value: "[", pos };
    }
    if (isDigit(c) || (c === "." && isDigit(src[pos + 1] ?? ""))) {
      return { type: "number", value: this.readNumber(), pos };
    }
    if (isNameStart(c)) {
      let end = pos + 1;
      while (end < src.length && isNameChar(src[end])) end++;
      this.pos = end;
      return { type: "name", value: src.slice(pos, end), pos };
    }
    if ("{}]=,;-".includes(c)) {
      this.pos++;
      return { type: "punct", value: c, pos };
    }
    this.error(`Unexpected character '${c}'`);
  }
}

class Parser {
  private lexer: Lexer;
  private token: Token;

  constructor(src: string) {
    this.lexer = new Lexer(src);
    this.token = this.lexer.next();
  }

  private advance(): Token {
    const t = this.token;
    this.token = this.lexer.next();
    return t;
  }

  private isPunct(value: string): boolean {
    return this.token.type === "punct" && this.token.value === value;
  }

  private expectPunct(value: string): void {
    if (!this.isPunct(value)) {
      throw new LuaParseError(`Expected '${value}'`, this.token.pos);
    }
    this.advance();
  }

  parseChunk(): Record<string, LuaValue> {
    const result: Record<string, LuaValue> = Object.create(null);
    while (this.token.type !== "eof") {
      if (this.isPunct(";")) {
        this.advance();
        continue;
      }
      const nameTok = this.advance();
      if (nameTok.type !== "name") throw new LuaParseError("Expected a variable name", nameTok.pos);
      this.expectPunct("=");
      result[nameTok.value] = this.parseValue(0);
    }
    return result;
  }

  private parseValue(depth: number): LuaValue {
    if (depth > MAX_DEPTH) throw new LuaParseError("Tables nested too deeply", this.token.pos);
    const t = this.token;
    switch (t.type) {
      case "string":
        this.advance();
        return t.value;
      case "number":
        this.advance();
        return t.value;
      case "name":
        this.advance();
        if (t.value === "true") return true;
        if (t.value === "false") return false;
        if (t.value === "nil") return null;
        if (t.value === "inf") return Infinity;
        if (t.value === "nan") return NaN;
        throw new LuaParseError(`Unexpected identifier '${t.value}'`, t.pos);
      case "punct":
        if (t.value === "{") return this.parseTable(depth + 1);
        if (t.value === "-") {
          this.advance();
          const v = this.parseValue(depth);
          if (typeof v !== "number") throw new LuaParseError("Expected a number after '-'", t.pos);
          return -v;
        }
        throw new LuaParseError(`Unexpected '${t.value}'`, t.pos);
      case "eof":
        throw new LuaParseError("Unexpected end of file", t.pos);
    }
  }

  private parseKey(value: LuaValue, pos: number): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    throw new LuaParseError("Unsupported table key", pos);
  }

  private parseTable(depth: number): LuaTable {
    this.expectPunct("{");
    const table: LuaTable = Object.create(null);
    let arrayIndex = 1;
    while (!this.isPunct("}")) {
      if (this.token.type === "eof") throw new LuaParseError("Unterminated table", this.token.pos);
      if (this.isPunct("[")) {
        const keyPos = this.token.pos;
        this.advance();
        const key = this.parseKey(this.parseValue(depth), keyPos);
        this.expectPunct("]");
        this.expectPunct("=");
        table[key] = this.parseValue(depth);
      } else if (this.token.type === "name" && !["true", "false", "nil"].includes(this.token.value)) {
        // `name = value` (record-style key) — peek for '=' by parsing the name first.
        const nameTok = this.advance() as Extract<Token, { type: "name" }>;
        if (this.isPunct("=")) {
          this.advance();
          table[nameTok.value] = this.parseValue(depth);
        } else {
          throw new LuaParseError(`Unexpected identifier '${nameTok.value}'`, nameTok.pos);
        }
      } else {
        table[String(arrayIndex++)] = this.parseValue(depth);
      }
      if (this.isPunct(",") || this.isPunct(";")) {
        this.advance();
      } else if (!this.isPunct("}")) {
        throw new LuaParseError("Expected ',' or '}'", this.token.pos);
      }
    }
    this.expectPunct("}");
    return table;
  }
}

/** Parses a SavedVariables file into `{ VariableName: value }`. Throws LuaParseError on malformed input. */
export function parseSavedVariables(source: string): Record<string, LuaValue> {
  if (source.length > MAX_INPUT_LENGTH) throw new LuaParseError("File is too large", 0);
  return new Parser(source).parseChunk();
}

export function isLuaTable(value: LuaValue | undefined): value is LuaTable {
  return typeof value === "object" && value !== null;
}
