// Prints the CHANGELOG.md section for a tag (e.g. v0.2.0) plus install notes.
import { readFileSync } from 'node:fs';

const tag = process.argv[2] ?? '';
const version = tag.replace(/^v/, '').split('-')[0];
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const match = changelog.match(new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));

console.log(match ? match[1].trim() : `Release ${tag}`);
console.log(`
### Install
- **Windows, Android, iOS:** download \`Outboards-${version}.mcaddon\` and open it. Minecraft imports both packs.
- Then edit or create a world and turn on **Outboards** under *Behavior Packs*. The resource pack is turned on automatically.
- The \`.mcpack\` files are the same packs separately, e.g. for servers.
- **Java Edition (Fabric):** put \`outboards-fabric-${version}+26.3.jar\` in your \`mods\` folder together with [Fabric API](https://modrinth.com/mod/fabric-api) and [GeckoLib](https://modrinth.com/mod/geckolib) (Minecraft 26.3).

Website, in English and Danish: https://ulfendk.github.io/minecraft-outboards/`);
