# Changelog

## [0.2.0] - 2026-11-07
### Added
- Inboard Engine (20,000 hp), on Bedrock and Java: a ship's diesel the size of a block. Place it anywhere inside a hull, facing the way the ship should go. With one aboard, a raft may be a ship of up to 4,096 blocks (256 without). One engine drives a ship of 1,000 blocks at 36 km/h; fit several for the biggest ships.
- It burns coal blocks, lava buckets (you keep the bucket) and blaze rods. A full tank lasts 3 minutes at full throttle. It is too big for a boat.
- Handbook page about ships, in English and Danish.

### Changed
- Bedrock: rafts are copied in tiles of 64×64 blocks (the most a structure holds). Going straight on, only the blocks the raft has left are cleared. Ships of more than 256 blocks move at most 11 km/h.
- Java: a ship's block displays are moved less often the bigger it is (every tick up to 512 blocks, every 8 ticks at 4,096), and the clients glide them in between.

### Fixed
- Bedrock: chests on a moving raft spilt their contents into the water at every step, so items were duplicated. Now they arrive with exactly what was in them.

## [0.1.0] - 2026-10-22
### Added
- Four outboard motors, on Bedrock and Java: 2 hp, 15 hp, a 90 hp V4 and a silent electric trolling motor. Each has its own model with a spinning propeller, and a recipe.
- Motorboats: use a motor on any wooden boat or a bamboo raft to clamp it on. Drive with W/S and A/D; sneak and right-click with an empty hand (or break it) to get the boat and the motor back.
- Rafts built from blocks: build anything on the water (up to 256 blocks), clamp motors onto its side at the water line, and right-click a motor or a ship's wheel to cast off. Chests keep their contents, and players and animals on the deck come along. Every motor on the raft pushes; big rafts are slower and turn slower.
  - Java Edition: the raft glides and turns smoothly, and is put down as blocks again, lined up with the world, when you stop.
  - Bedrock Edition: the raft moves a block at a time and turns in quarter turns.
- Fuel: coal, charcoal and blaze rods for the petrol motors, redstone for the electric one. Right-click a motor with fuel to fill it up.
- One water model for both editions (speed, drag, steering, fuel use), checked against each other in the tests.
- Ship's wheel, Outboard Handbook, English and Danish.
