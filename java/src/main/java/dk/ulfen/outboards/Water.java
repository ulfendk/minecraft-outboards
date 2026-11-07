package dk.ulfen.outboards;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * How a boat or raft with outboard motors moves on the water: a line-for-line port of
 * src/lib/water.mjs, which the Bedrock add-on runs (OutboardGameTests.waterMatchesJs checks
 * that they agree). Units are blocks and ticks; yaw is Minecraft's.
 */
public final class Water {
	public static final double K = 0.105;
	public static final double DRAG = 0.05;
	public static final double BOAT_MASS = 6;
	public static final double SPOOL = 0.04;
	public static final double REVERSE = 0.5;
	public static final int MAX_RAFT = 256;
	public static final int MAX_SHIP = 4096;

	private Water() {}

	public record Input(double fwd, double side) {
		public static final Input NONE = new Input(0, 0);
	}

	public record Env(boolean afloat, boolean fuel) {}

	public record Vessel(double thrust, double mass, double maxSpeed, double turn) {}

	public static final class State {
		public double speed, yaw, throttle, vx, vz, burn;

		public static State initial(double yaw) {
			State s = new State();
			s.yaw = yaw;
			return s;
		}

		public State copy() {
			State s = new State();
			s.speed = speed; s.yaw = yaw; s.throttle = throttle; s.vx = vx; s.vz = vz; s.burn = burn;
			return s;
		}
	}

	private static double clamp(double v, double lo, double hi) {
		return Math.max(lo, Math.min(hi, v));
	}

	private static double toward(double v, double target, double rate) {
		return v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
	}

	private static double r6(double n) {
		return Math.round(n * 1e6) / 1e6;
	}

	public static Vessel vessel(List<MotorSpec> motors, double mass) {
		double thrust = 0, max = 0;
		for (MotorSpec m : motors) {
			thrust += m.thrust;
			max = Math.max(max, m.maxSpeed);
		}
		return new Vessel(thrust, mass, max, r6(clamp(4 / Math.sqrt(mass / BOAT_MASS), 0.6, 4)));
	}

	public static double topSpeed(Vessel v) {
		return Math.min(v.maxSpeed(), K * v.thrust() / (v.mass() * DRAG));
	}

	public static State step(State s, Input input, Vessel v, Env env) {
		double target = !env.fuel() ? 0 : input.fwd() > 0 ? 1 : input.fwd() < 0 ? -REVERSE : 0;
		double throttle = toward(s.throttle, target, SPOOL);
		double speed = s.speed;
		if (env.afloat()) {
			speed += K * v.thrust() * throttle / v.mass() - DRAG * speed;
			speed = clamp(speed, -v.maxSpeed() * REVERSE, v.maxSpeed());
		} else {
			speed *= 0.5;
		}
		if (Math.abs(speed) < 1e-4 && throttle == 0) speed = 0;
		double bite = clamp(0.25 + Math.abs(speed) / 0.25, 0, 1) * (env.afloat() ? 1 : 0.2);
		double yaw = s.yaw - input.side() * v.turn() * bite;
		yaw = ((yaw % 360) + 360) % 360;
		double rad = yaw * Math.PI / 180;
		State out = new State();
		out.speed = r6(speed);
		out.yaw = r6(yaw);
		out.throttle = r6(throttle);
		out.vx = r6(-Math.sin(rad) * speed);
		out.vz = r6(Math.cos(rad) * speed);
		out.burn = r6(Math.abs(throttle));
		return out;
	}

	// ------------------------------------------------------------ rafts

	public static final Pattern WATERY = Pattern.compile("^minecraft:(water|flowing_water|seagrass|tall_seagrass|kelp|kelp_plant|bubble_column)$");
	public static final Pattern TERRAIN = Pattern.compile("^minecraft:(bedrock|stone|deepslate|dirt|coarse_dirt|grass_block|podzol|mycelium|rooted_dirt|mud|clay|sand|red_sand|gravel|sandstone|red_sandstone|granite|diorite|andesite|tuff|calcite|netherrack|end_stone|ice|packed_ice|blue_ice|snow_block|terracotta|.*_terracotta|.*_ore|dirt_path|farmland|suspicious_sand|suspicious_gravel|magma)$");

	/** Block id at a position ("minecraft:air" ...), or null where the world isn't loaded. */
	public interface Getter {
		String get(int x, int y, int z);
	}

	public record Cell(int x, int y, int z) {}

	/** ok, or a reason: too_big, grounded, not_afloat. */
	public record Scan(boolean ok, String reason, List<Cell> cells) {}

	private static final int[][] N6 = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};

	private static boolean watery(String id) {
		return id != null && WATERY.matcher(id).matches();
	}

	/** The raft a block belongs to (see scanRaft in water.mjs). */
	public static Scan scanRaft(Getter get, Cell start, int max) {
		Set<Cell> seen = new HashSet<>();
		seen.add(start);
		List<Cell> cells = new ArrayList<>();
		ArrayDeque<Cell> queue = new ArrayDeque<>();
		queue.add(start);
		while (!queue.isEmpty()) {
			Cell c = queue.poll();
			String id = get.get(c.x(), c.y(), c.z());
			if (id != null && TERRAIN.matcher(id).matches()) return new Scan(false, "grounded", List.of());
			cells.add(c);
			if (cells.size() > max) return new Scan(false, "too_big", List.of());
			for (int[] d : N6) {
				Cell n = new Cell(c.x() + d[0], c.y() + d[1], c.z() + d[2]);
				if (!seen.add(n)) continue;
				String nid = get.get(n.x(), n.y(), n.z());
				if (nid == null || nid.equals("minecraft:air") || watery(nid)) continue;
				queue.add(n);
			}
		}
		Map<Long, Cell> bottoms = new HashMap<>();
		for (Cell c : cells) {
			long k = ((long) c.x() << 32) ^ (c.z() & 0xffffffffL);
			Cell b = bottoms.get(k);
			if (b == null || b.y() > c.y()) bottoms.put(k, c);
		}
		int wet = 0;
		for (Cell b : bottoms.values()) if (watery(get.get(b.x(), b.y() - 1, b.z()))) wet++;
		if (wet == 0) return new Scan(false, "not_afloat", List.of());
		if (wet < bottoms.size() / 2.0) return new Scan(false, "grounded", List.of());
		return new Scan(true, null, cells);
	}

	/** The raft or ship a block belongs to (see scanVessel in water.mjs). */
	public static Scan scanVessel(Getter get, Cell start, java.util.function.Predicate<String> isInboard) {
		Scan r = scanRaft(get, start, MAX_SHIP);
		if (r.ok() && r.cells().size() > MAX_RAFT && r.cells().stream().noneMatch(c -> isInboard.test(get.get(c.x(), c.y(), c.z())))) {
			return new Scan(false, "too_big", List.of());
		}
		return r;
	}

	/** The water level a raft floats at: the highest water block next to or under it. */
	public static int waterLevel(Getter get, List<Cell> cells) {
		Set<Cell> in = new HashSet<>(cells);
		int level = Integer.MIN_VALUE;
		int min = Integer.MAX_VALUE;
		for (Cell c : cells) {
			min = Math.min(min, c.y());
			for (int[] d : N6) {
				Cell n = new Cell(c.x() + d[0], c.y() + d[1], c.z() + d[2]);
				if (in.contains(n)) continue;
				String id = get.get(n.x(), n.y(), n.z());
				if ("minecraft:water".equals(id) || "minecraft:flowing_water".equals(id)) level = Math.max(level, n.y());
			}
		}
		return level == Integer.MIN_VALUE ? min - 1 : level;
	}

	// ------------------------------------------------------------ the inboard engine

	/** The inboard engine is built of blocks: 2 wide, 2 high and 6 long. */
	public static final int[] ENGINE = {2, 2, 6};

	/** Quarter turns from north for a horizontal facing ("north", "east", ...). */
	public static int quarter(String facing) {
		return switch (facing) {
			case "east" -> 1;
			case "south" -> 2;
			case "west" -> 3;
			default -> 0;
		};
	}

	/** Offset of an engine part from part 0,0,0, with the propeller end pointing `facing` (see engineCells in water.mjs). */
	public static int[] engineOffset(int px, int py, int pz, String facing) {
		int[] r = rotateQuarter(px, pz, quarter(facing));
		return new int[] {r[0], py, r[1]};
	}

	/** Turns a horizontal offset by quarter turns clockwise (east -> south). */
	public static int[] rotateQuarter(int x, int z, int quarters) {
		int q = ((quarters % 4) + 4) % 4;
		return switch (q) {
			case 1 -> new int[] {-z, x};
			case 2 -> new int[] {-x, -z};
			case 3 -> new int[] {z, -x};
			default -> new int[] {x, z};
		};
	}
}
