# Race artwork (optional)

Out of the box the widget draws an original heraldic **race badge** (faction-tinted shield
with the race monogram and a ♂/♀ pip) for the *Race + Class* avatar mode, so no Blizzard
artwork is bundled.

To use your own race/gender portraits instead, drop image files in this folder and rebuild:

```
<RaceToken>_<male|female>.png    e.g. NightElf_female.png, Scourge_male.webp
<RaceToken>.png                  used for both genders
```

`RaceToken` is the second value returned by `UnitRace("player")` in-game
(`Human`, `Dwarf`, `NightElf`, `Gnome`, `Orc`, `Scourge`, `Tauren`, `Troll`, `BloodElf`, ...).
Supported formats: `.png`, `.svg`, `.webp`, `.jpg`.
