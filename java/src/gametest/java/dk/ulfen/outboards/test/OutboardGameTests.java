package dk.ulfen.outboards.test;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dk.ulfen.outboards.ModRegistry;
import dk.ulfen.outboards.MotorSpec;
import dk.ulfen.outboards.Water;
import dk.ulfen.outboards.boat.MotorboatEntity;
import dk.ulfen.outboards.raft.InboardBlock;
import dk.ulfen.outboards.raft.MotorBlock;
import dk.ulfen.outboards.raft.PropellerBlock;
import dk.ulfen.outboards.raft.RaftEntity;
import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.Container;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.vehicle.boat.Boat;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/** Server-side checks run by `./gradlew runGameTest` (and in CI). */
public class OutboardGameTests {
	private static final String AREA = "outboards-test:empty_large";

	/** A pond three blocks deep over the test floor: water at y 1..3, its surface at y 4. */
	private static void pond(GameTestHelper helper) {
		for (int x = 1; x < 39; x++) for (int z = 1; z < 39; z++) for (int y = 1; y <= 3; y++) helper.setBlock(new BlockPos(x, y, z), Blocks.WATER);
	}

	private static JsonArray json(String path) throws java.io.IOException {
		try (var in = OutboardGameTests.class.getResourceAsStream(path)) {
			return JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonArray();
		}
	}

	/** The Java water model gives the same numbers as the JavaScript one (water_fixtures.json). */
	@GameTest
	public void waterMatchesJs(GameTestHelper helper) {
		try {
			for (JsonElement el : json("/outboards/water_fixtures.json")) {
				JsonObject fx = el.getAsJsonObject();
				JsonObject vj = fx.getAsJsonObject("vessel");
				Water.Vessel v = new Water.Vessel(vj.get("thrust").getAsDouble(), vj.get("mass").getAsDouble(), vj.get("maxSpeed").getAsDouble(), vj.get("turn").getAsDouble());
				Water.State s = Water.State.initial(30);
				int t = 0;
				for (JsonElement tickEl : fx.getAsJsonArray("ticks")) {
					JsonObject tick = tickEl.getAsJsonObject();
					JsonObject i = tick.getAsJsonObject("input"), e = tick.getAsJsonObject("env"), want = tick.getAsJsonObject("state");
					s = Water.step(s, new Water.Input(i.get("fwd").getAsDouble(), i.get("side").getAsDouble()), v,
						new Water.Env(e.get("afloat").getAsBoolean(), e.get("fuel").getAsBoolean()));
					double[][] pairs = {{s.speed, want.get("speed").getAsDouble()}, {s.yaw, want.get("yaw").getAsDouble()}, {s.throttle, want.get("throttle").getAsDouble()},
						{s.vx, want.get("vx").getAsDouble()}, {s.vz, want.get("vz").getAsDouble()}, {s.burn, want.get("burn").getAsDouble()}};
					String[] names = {"speed", "yaw", "throttle", "vx", "vz", "burn"};
					for (int k = 0; k < pairs.length; k++) {
						if (Math.abs(pairs[k][0] - pairs[k][1]) > 2e-6) helper.fail(fx.get("id").getAsString() + " tick " + t + ": " + names[k] + " is " + pairs[k][0] + " in Java, " + pairs[k][1] + " in JavaScript");
					}
					t++;
				}
			}
			// The vessel numbers agree too.
			MotorSpec large = ModRegistry.motor("large_motor");
			Water.Vessel two = Water.vessel(List.of(large, large), 44);
			if (two.thrust() != large.thrust * 2) helper.fail("two motors don't add up");
		} catch (Exception ex) {
			helper.fail(ex.toString());
		}
		helper.succeed();
	}

	/** The Java raft scanner finds the same raft as the JavaScript one (scan_fixture.json). */
	@GameTest
	public void scanMatchesJs(GameTestHelper helper) {
		try (var in = OutboardGameTests.class.getResourceAsStream("/outboards/scan_fixture.json")) {
			JsonObject fx = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
			Map<String, String> world = new HashMap<>();
			for (JsonElement e : fx.getAsJsonArray("world")) world.put(e.getAsJsonArray().get(0).getAsString(), e.getAsJsonArray().get(1).getAsString());
			JsonArray st = fx.getAsJsonArray("start");
			Water.Scan scan = Water.scanRaft((x, y, z) -> world.getOrDefault(x + "," + y + "," + z, "minecraft:air"),
				new Water.Cell(st.get(0).getAsInt(), st.get(1).getAsInt(), st.get(2).getAsInt()), Water.MAX_RAFT);
			JsonObject want = fx.getAsJsonObject("result");
			if (scan.ok() != want.get("ok").getAsBoolean()) helper.fail("scan ok " + scan.ok() + " / " + scan.reason());
			if (scan.ok() && scan.cells().size() != want.getAsJsonArray("cells").size()) helper.fail("scan found " + scan.cells().size() + " blocks, JavaScript " + want.getAsJsonArray("cells").size());
		} catch (Exception ex) {
			helper.fail(ex.toString());
		}
		helper.succeed();
	}

	/** Every motorboat can be put on the water and floats there. */
	@GameTest(maxTicks = 100, structure = AREA)
	public void everyBoatFloats(GameTestHelper helper) {
		pond(helper);
		int i = 0;
		List<MotorboatEntity> all = new java.util.ArrayList<>();
		for (var spec : ModRegistry.BOATS) {
			MotorboatEntity b = helper.spawn(ModRegistry.boatType(spec), new Vec3(4.5 + (i % 5) * 6, 3.7, 6.5 + (i / 5) * 8));
			b.setMotor(ModRegistry.OUTBOARDS.get(i % ModRegistry.OUTBOARDS.size()));
			all.add(b);
			i++;
		}
		double surface = helper.absoluteVec(new Vec3(0, 4, 0)).y;
		helper.runAfterDelay(60, () -> {
			for (MotorboatEntity b : all) {
				if (!b.isAlive()) helper.fail(b.spec.id + " vanished");
				if (Math.abs(b.getY() - (surface - 0.3)) > 0.15) helper.fail(b.spec.id + " not floating: y " + b.getY() + ", surface " + surface);
			}
			helper.succeed();
		});
	}

	/** Using a motor on a vanilla boat makes a motorboat of the same wood. */
	@GameTest(maxTicks = 40, structure = AREA)
	public void fitMotorToBoat(GameTestHelper helper) {
		pond(helper);
		Boat boat = helper.spawn(EntityTypes.SPRUCE_BOAT, new Vec3(10.5, 4, 10.5));
		helper.runAfterDelay(2, () -> {
			MotorboatEntity m = MotorboatEntity.fit(helper.getLevel(), boat, ModRegistry.motor("electric_motor"));
			if (m == null) helper.fail("no motorboat");
			else if (!m.spec.wood.equals("spruce")) helper.fail("made a " + m.spec.wood + " motorboat from a spruce boat");
			else if (m.motor() != ModRegistry.motor("electric_motor")) helper.fail("wrong motor " + m.motor().id);
			if (!boat.isRemoved()) helper.fail("the vanilla boat is still there");
			helper.succeed();
		});
	}

	/** A motorboat with fuel drives off, floating, and burns fuel; without fuel it stays. */
	@GameTest(maxTicks = 120, structure = AREA)
	public void motorboatDrives(GameTestHelper helper) {
		pond(helper);
		MotorboatEntity b = helper.spawn(ModRegistry.boatType(ModRegistry.BOATS.getFirst()), new Vec3(4.5, 3.7, 10.5));
		MotorboatEntity dry = helper.spawn(ModRegistry.boatType(ModRegistry.BOATS.getFirst()), new Vec3(4.5, 3.7, 24.5));
		for (MotorboatEntity m : List.of(b, dry)) {
			m.snapTo(m.getX(), m.getY(), m.getZ(), 270, 0); // facing east
			m.setMotor(ModRegistry.motor("medium_motor"));
			m.testInput = new Water.Input(1, 0);
		}
		b.setFuel(8);
		Vec3 start = b.position(), dryStart = dry.position();
		double surface = helper.absoluteVec(new Vec3(0, 4, 0)).y;
		helper.runAfterDelay(60, () -> {
			double moved = b.position().subtract(start).horizontalDistance();
			if (moved < 6) helper.fail("drove only " + moved + " blocks");
			if (b.getX() <= start.x + 5) helper.fail("did not drive east");
			if (Math.abs(b.getY() - (surface - 0.3)) > 0.2) helper.fail("not floating: y " + b.getY());
			if (!(b.fuel() < 8)) helper.fail("burnt no fuel");
			if (dry.position().subtract(dryStart).horizontalDistance() > 0.2) helper.fail("drove without fuel");
			helper.succeed();
		});
	}

	/** A raft with a chest on it casts off, sails north, turns, and is put down again in one piece. */
	@GameTest(maxTicks = 400, structure = AREA)
	public void raftSailsAndMoors(GameTestHelper helper) {
		pond(helper);
		for (int x = 10; x <= 12; x++) for (int z = 22; z <= 25; z++) helper.setBlock(new BlockPos(x, 3, z), Blocks.OAK_PLANKS);
		helper.setBlock(new BlockPos(10, 4, 22), Blocks.OAK_LOG);
		helper.setBlock(new BlockPos(11, 4, 24), Blocks.CHEST);
		if (helper.getLevel().getBlockEntity(helper.absolutePos(new BlockPos(11, 4, 24))) instanceof Container c) c.setItem(0, new ItemStack(Items.DIAMOND, 3));
		BlockPos motor = new BlockPos(11, 3, 26);
		helper.setBlock(motor, ModRegistry.MOTOR_BLOCKS.get("small_motor").defaultBlockState().setValue(MotorBlock.FACING, Direction.SOUTH).setValue(MotorBlock.FUEL, 12));
		RaftEntity[] raft = new RaftEntity[1];
		double[] z0 = new double[1];
		helper.runAfterDelay(2, () -> {
			raft[0] = RaftEntity.start(helper.getLevel(), helper.absolutePos(motor), null);
			if (raft[0] == null) {
				helper.fail("raft did not start: " + RaftEntity.lastFailure);
				return;
			}
			if (raft[0].parts().size() != 15) helper.fail("raft has " + raft[0].parts().size() + " blocks, expected 15");
			if (!helper.getLevel().getBlockState(helper.absolutePos(new BlockPos(11, 3, 23))).is(Blocks.WATER)) helper.fail("the raft's blocks were not lifted out");
			raft[0].testInput = new Water.Input(1, 0);
			z0[0] = raft[0].getZ();
		});
		helper.runAfterDelay(120, () -> {
			if (raft[0] == null) return;
			if (raft[0].getZ() > z0[0] - 3) helper.fail("raft did not sail north: z " + raft[0].getZ() + " from " + z0[0]);
			raft[0].testInput = new Water.Input(1, -1); // turn right
		});
		helper.runAfterDelay(220, () -> {
			if (raft[0] == null) return;
			if (Math.abs(raft[0].getYRot()) < 20) helper.fail("raft did not turn: " + raft[0].getYRot());
			for (var part : raft[0].parts()) if (part.motor() && part.fuel >= 12) helper.fail("the motor burnt no fuel");
			raft[0].testInput = null;
		});
		helper.runAfterDelay(230, () -> {
			if (raft[0] == null) return;
			if (!raft[0].isRemoved()) helper.fail("raft did not moor without a driver");
			// Count what is in the pond now.
			int planks = 0, logs = 0, chests = 0, motors = 0, diamonds = 0;
			for (int x = 0; x < 40; x++) for (int z = 0; z < 40; z++) for (int y = 1; y <= 6; y++) {
				BlockPos p = helper.absolutePos(new BlockPos(x, y, z));
				var s = helper.getLevel().getBlockState(p);
				if (s.is(Blocks.OAK_PLANKS)) planks++;
				if (s.is(Blocks.OAK_LOG)) logs++;
				if (s.getBlock() instanceof MotorBlock) motors++;
				if (helper.getLevel().getBlockEntity(p) instanceof ChestBlockEntity chest) {
					chests++;
					for (int i = 0; i < chest.getContainerSize(); i++) if (chest.getItem(i).is(Items.DIAMOND)) diamonds += chest.getItem(i).getCount();
				}
			}
			if (planks != 12 || logs != 1 || chests != 1 || motors != 1) helper.fail("after mooring: " + planks + " planks, " + logs + " logs, " + chests + " chests, " + motors + " motors");
			if (diamonds != 3) helper.fail("the chest has " + diamonds + " diamonds");
			var displays = helper.getLevel().getEntities(EntityTypes.BLOCK_DISPLAY, new AABB(helper.absolutePos(BlockPos.ZERO)).inflate(64), d -> d.entityTags().contains(RaftEntity.DISPLAY_TAG));
			if (!displays.isEmpty()) helper.fail(displays.size() + " block displays left behind");
			helper.succeed();
		});
	}

	/**
	 * A barge of 300 blocks is too big for an outboard. With an inboard engine on the deck it is
	 * a ship, but it needs a propeller; with one it casts off, sails north and is put down
	 * again in one piece.
	 */
	@GameTest(maxTicks = 200, structure = AREA)
	public void shipWithInboardSails(GameTestHelper helper) {
		pond(helper);
		for (int x = 5; x < 35; x++) for (int z = 20; z < 30; z++) helper.setBlock(new BlockPos(x, 3, z), Blocks.OAK_PLANKS);
		helper.setBlock(new BlockPos(25, 4, 25), Blocks.CHEST);
		if (helper.getLevel().getBlockEntity(helper.absolutePos(new BlockPos(25, 4, 25))) instanceof Container c) c.setItem(0, new ItemStack(Items.EMERALD, 4));
		BlockPos outboard = new BlockPos(20, 3, 30);
		helper.setBlock(outboard, ModRegistry.MOTOR_BLOCKS.get("large_motor").defaultBlockState().setValue(MotorBlock.FACING, Direction.SOUTH).setValue(MotorBlock.FUEL, 12));
		// The engine's first block at the aft end; it reaches 6 blocks north and 2 up.
		BlockPos engine = new BlockPos(20, 4, 26);
		InboardBlock block = (InboardBlock) ModRegistry.MOTOR_BLOCKS.get("inboard_engine");
		RaftEntity[] ship = new RaftEntity[1];
		double[] z0 = new double[1];
		helper.runAfterDelay(2, () -> {
			if (RaftEntity.start(helper.getLevel(), helper.absolutePos(outboard), null) != null) helper.fail("a 302-block raft with only an outboard cast off");
			else if (!"too_big".equals(RaftEntity.lastFailure)) helper.fail("the big raft failed for " + RaftEntity.lastFailure);
			helper.setBlock(outboard, Blocks.WATER);
			if (!block.build(helper.getLevel(), helper.absolutePos(engine), Direction.SOUTH, 12, true)) helper.fail("no room for the engine");
			if (!helper.getLevel().getBlockState(helper.absolutePos(new BlockPos(19, 5, 21))).is(block)) helper.fail("the engine's far corner is not where it should be");
			// Without a propeller it doesn't go; started from another block of the engine.
			if (RaftEntity.start(helper.getLevel(), helper.absolutePos(new BlockPos(19, 5, 23)), null) != null) helper.fail("a ship without a propeller cast off");
			else if (!"no_propeller".equals(RaftEntity.lastFailure)) helper.fail("the ship without a propeller failed for " + RaftEntity.lastFailure);
			helper.setBlock(outboard, ModRegistry.PROPELLER.defaultBlockState().setValue(PropellerBlock.FACING, Direction.SOUTH));
			ship[0] = RaftEntity.start(helper.getLevel(), helper.absolutePos(new BlockPos(20, 5, 24)), null);
			if (ship[0] == null) {
				helper.fail("the ship did not start: " + RaftEntity.lastFailure);
				return;
			}
			if (ship[0].parts().size() != 326) helper.fail("the ship has " + ship[0].parts().size() + " blocks, expected 326");
			if (ship[0].motorCount() != 1) helper.fail("the engine counts as " + ship[0].motorCount() + " motors");
			ship[0].testInput = new Water.Input(1, 0);
			z0[0] = ship[0].getZ();
		});
		helper.runAfterDelay(50, () -> {
			if (ship[0] == null) return;
			if (ship[0].getZ() > z0[0] - 3) helper.fail("the ship did not sail north: z " + ship[0].getZ() + " from " + z0[0]);
			ship[0].testInput = null;
		});
		helper.runAfterDelay(60, () -> {
			if (ship[0] == null) return;
			if (!ship[0].isRemoved()) helper.fail("the ship did not moor without a driver");
			int planks = 0, engines = 0, props = 0, emeralds = 0;
			for (int x = 0; x < 40; x++) for (int z = 0; z < 40; z++) for (int y = 1; y <= 6; y++) {
				BlockPos p = helper.absolutePos(new BlockPos(x, y, z));
				var st = helper.getLevel().getBlockState(p);
				if (st.is(Blocks.OAK_PLANKS)) planks++;
				if (st.is(block)) engines++;
				if (st.is(ModRegistry.PROPELLER)) props++;
				if (helper.getLevel().getBlockEntity(p) instanceof ChestBlockEntity chest) {
					for (int i = 0; i < chest.getContainerSize(); i++) if (chest.getItem(i).is(Items.EMERALD)) emeralds += chest.getItem(i).getCount();
				}
			}
			if (planks != 300 || engines != 24 || props != 1) helper.fail("after mooring: " + planks + " planks, " + engines + " engine blocks, " + props + " propellers");
			if (emeralds != 4) helper.fail("the chest has " + emeralds + " emeralds");
			helper.succeed();
		});
	}

	/** A raft that touches the shore doesn't cast off. */
	@GameTest(maxTicks = 20, structure = AREA)
	public void groundedRaftStays(GameTestHelper helper) {
		pond(helper);
		helper.setBlock(new BlockPos(20, 3, 20), Blocks.OAK_PLANKS);
		helper.setBlock(new BlockPos(20, 3, 21), Blocks.DIRT);
		BlockPos motor = new BlockPos(20, 3, 19);
		helper.setBlock(motor, ModRegistry.MOTOR_BLOCKS.get("small_motor").defaultBlockState().setValue(MotorBlock.FACING, Direction.NORTH).setValue(MotorBlock.FUEL, 12));
		helper.runAfterDelay(2, () -> {
			if (RaftEntity.start(helper.getLevel(), helper.absolutePos(motor), null) != null) helper.fail("a raft joined to dirt cast off");
			else if (!"grounded".equals(RaftEntity.lastFailure)) helper.fail("failed for " + RaftEntity.lastFailure);
			helper.succeed();
		});
	}
}
