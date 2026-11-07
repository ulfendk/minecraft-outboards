package dk.ulfen.outboards.raft;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.mojang.math.Transformation;
import dk.ulfen.outboards.Fuel;
import dk.ulfen.outboards.ModRegistry;
import dk.ulfen.outboards.MotorSpec;
import dk.ulfen.outboards.Water;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.util.ProblemReporter;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityDimensions;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.TagValueInput;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.joml.Vector3f;
import org.jspecify.annotations.Nullable;

/**
 * A raft under way. When it casts off, its blocks are taken out of the world (chests keep
 * what is in them) and shown as block displays that this entity moves and turns smoothly,
 * steered by the driver with {@link Water} (the same model as boats and the Bedrock add-on).
 * Players and animals on the deck ride along. When the driver gets off (sneak), the raft is
 * put back down as blocks, turned to the nearest quarter and lined up with the world.
 *
 * Offsets are block offsets from the pivot (a block centre in the middle of the raft) as the
 * raft lay when it cast off; the entity's yaw is how far it has turned since.
 */
public class RaftEntity extends Entity {
	private static final EntityDataAccessor<Float> WIDTH = SynchedEntityData.defineId(RaftEntity.class, EntityDataSerializers.FLOAT);
	private static final EntityDataAccessor<Float> HEIGHT = SynchedEntityData.defineId(RaftEntity.class, EntityDataSerializers.FLOAT);
	/** Where each passenger sits, in passenger order: "x,y,z;x,y,z". */
	private static final EntityDataAccessor<String> SEATS = SynchedEntityData.defineId(RaftEntity.class, EntityDataSerializers.STRING);
	public static final String DISPLAY_TAG = "outboards.raft";

	/** A block of the raft. fuel is only used for motors. */
	public static final class Part {
		public BlockState state;
		public @Nullable CompoundTag blockEntity;
		public final int ox, oy, oz;
		public double fuel;
		Display.@Nullable BlockDisplay display;

		Part(BlockState state, @Nullable CompoundTag blockEntity, int ox, int oy, int oz) {
			this.state = state;
			this.blockEntity = blockEntity;
			this.ox = ox;
			this.oy = oy;
			this.oz = oz;
		}

		public boolean motor() {
			return state.getBlock() instanceof MotorBlock;
		}
	}

	private final List<Part> parts = new ArrayList<>();
	private final Set<Long> columnsBelow = new HashSet<>();
	private final Map<java.util.UUID, Vec3> seats = new HashMap<>();
	private List<Vec3> clientSeats = List.of();
	private int water;
	/** The heading when it cast off (yaw 0 of this entity is that heading). */
	private float heading0;
	private Water.State state = Water.State.initial(0);
	private boolean restored, moored;
	private int blockedAt = -99, hudAfter;
	/** The selftest drives a raft without anyone on it. */
	public Water.@Nullable Input testInput;
	/** Why the last start() failed (for messages and tests). */
	public static @Nullable String lastFailure;

	public RaftEntity(EntityType<? extends RaftEntity> type, Level level) {
		super(type, level);
		this.noPhysics = true;
	}

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		builder.define(WIDTH, 1F);
		builder.define(HEIGHT, 1F);
		builder.define(SEATS, "");
	}

	public List<Part> parts() {
		return parts;
	}

	public Water.State water() {
		return state;
	}

	public double heading() {
		return heading0 + this.getYRot();
	}

	// ------------------------------------------------------------ casting off

	private static @Nullable String idAt(Level level, BlockPos p) {
		if (!level.isLoaded(p)) return null;
		return BuiltInRegistries.BLOCK.getKey(level.getBlockState(p).getBlock()).toString();
	}

	private static Direction opposite(Direction d) {
		return d.getOpposite();
	}

	/** Scans the raft the block at pos belongs to and casts off with the player at the helm. */
	public static @Nullable RaftEntity start(ServerLevel level, BlockPos at, @Nullable Player player) {
		lastFailure = null;
		Water.Getter get = (x, y, z) -> idAt(level, new BlockPos(x, y, z));
		Water.Scan scan = Water.scanVessel(get, new Water.Cell(at.getX(), at.getY(), at.getZ()), RaftEntity::inboardId);
		if (!scan.ok()) return fail(player, scan.reason());
		BlockPos firstMotor = null, helm = null;
		int minX = Integer.MAX_VALUE, maxX = Integer.MIN_VALUE, minZ = Integer.MAX_VALUE, maxZ = Integer.MIN_VALUE, minY = Integer.MAX_VALUE;
		for (Water.Cell c : scan.cells()) {
			BlockPos p = new BlockPos(c.x(), c.y(), c.z());
			Block b = level.getBlockState(p).getBlock();
			if (b instanceof MotorBlock && (firstMotor == null || p.equals(at))) firstMotor = p;
			if (b instanceof HelmBlock) helm = p;
			minX = Math.min(minX, c.x()); maxX = Math.max(maxX, c.x());
			minZ = Math.min(minZ, c.z()); maxZ = Math.max(maxZ, c.z());
			minY = Math.min(minY, c.y());
		}
		if (firstMotor == null) return fail(player, "no_motor");
		int px = Math.floorDiv(minX + maxX, 2), pz = Math.floorDiv(minZ + maxZ, 2);
		// The raft goes where its motor pushes it: the opposite way to the propeller.
		Direction heading = opposite(level.getBlockState(firstMotor).getValue(MotorBlock.FACING));
		RaftEntity raft = new RaftEntity(ModRegistry.RAFT, level);
		raft.water = Water.waterLevel(get, scan.cells());
		raft.heading0 = heading.toYRot();
		raft.state = Water.State.initial(raft.heading0);
		raft.snapTo(px + 0.5, minY, pz + 0.5, 0, 0);

		// Lift the blocks out of the world: block entities first, then hanging things first.
		BlockState waterState = Blocks.WATER.defaultBlockState(), air = Blocks.AIR.defaultBlockState();
		int flags = Block.UPDATE_CLIENTS | Block.UPDATE_KNOWN_SHAPE | Block.UPDATE_SUPPRESS_DROPS | Block.UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS;
		float radius = 0;
		int top = 0;
		for (Water.Cell c : scan.cells()) {
			BlockPos p = new BlockPos(c.x(), c.y(), c.z());
			BlockState s = level.getBlockState(p);
			BlockEntity be = level.getBlockEntity(p);
			Part part = new Part(s, be != null ? be.saveWithFullMetadata(level.registryAccess()) : null, c.x() - px, c.y() - minY, c.z() - pz);
			if (part.motor()) part.fuel = s.getValue(MotorBlock.FUEL);
			raft.parts.add(part);
			radius = (float) Math.max(radius, Math.hypot(part.ox, part.oz) + 0.75);
			top = Math.max(top, part.oy + 1);
		}
		for (Part part : raft.parts) raft.columnsBelow.add(key(part.ox, part.oy, part.oz));
		List<Part> order = new ArrayList<>(raft.parts);
		order.sort((a, b) -> Boolean.compare(a.state.isSolid(), b.state.isSolid()) != 0 ? Boolean.compare(a.state.isSolid(), b.state.isSolid()) : b.oy - a.oy);
		for (Part part : order) {
			BlockPos p = new BlockPos(px + part.ox, minY + part.oy, pz + part.oz);
			level.setBlock(p, p.getY() <= raft.water ? waterState : air, flags);
		}
		raft.entityData.set(WIDTH, radius * 2);
		raft.entityData.set(HEIGHT, (float) top);
		level.addFreshEntity(raft);
		for (Part part : raft.parts) raft.spawnDisplay(level, part);
		raft.placeDisplays();

		// Everyone on the deck comes along; the driver stands behind the wheel, or in front of the motor.
		if (player != null) {
			BlockPos seat = helm != null
				? helm.relative(level.getBlockState(helm).getValue(HelmBlock.FACING).getOpposite())
				: firstMotor.relative(heading).above();
			raft.seats.put(player.getUUID(), new Vec3(seat.getX() - px, seat.getY() - minY, seat.getZ() - pz));
			player.startRiding(raft, true, true);
			player.sendOverlayMessage(Component.translatable("outboards.raft.start", raft.parts.size(), motorsText(raft.motorCount())));
			player.sendSystemMessage(Component.empty().append(Component.translatable("outboards.handbook.raft").withStyle(ChatFormatting.YELLOW))
				.append(": ").append(Component.translatable("outboards.controls.java.raft")));
		}
		AABB deck = new AABB(minX - px - 0.5, 0, minZ - pz - 0.5, maxX - px + 0.5, top + 2, maxZ - pz + 0.5).move(raft.position());
		for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class, deck, e -> !e.isPassenger() && e != player)) {
			raft.seats.put(e.getUUID(), e.position().subtract(raft.position()));
			e.startRiding(raft, true, true);
		}
		raft.syncSeats();
		level.playSound(null, at, SoundEvents.ANVIL_USE, SoundSource.BLOCKS, 0.4F, 1.6F);
		return raft;
	}

	/** Is this block id an inboard engine (which lets a raft be a ship of up to MAX_SHIP blocks)? */
	private static boolean inboardId(@Nullable String id) {
		if (id == null) return false;
		for (MotorSpec m : ModRegistry.MOTORS) if (m.inboard && id.equals("outboards:" + m.id + "_mounted")) return true;
		return false;
	}

	/**
	 * How often (in ticks) the block displays are moved: every tick for a raft, less often for a
	 * big ship (with the clients gliding them there in between), so that a ship of thousands of
	 * blocks doesn't send thousands of updates every tick.
	 */
	private int displayEvery() {
		return Mth.clamp((parts.size() + 511) / 512, 1, 8);
	}

	private static Component motorsText(int n) {
		return n == 1 ? Component.translatable("outboards.motors.one") : Component.translatable("outboards.motors.many", n);
	}

	private static @Nullable RaftEntity fail(@Nullable Player player, String reason) {
		lastFailure = reason;
		if (player != null) player.sendOverlayMessage(Component.translatable("outboards.raft." + reason));
		return null;
	}

	private static long key(int x, int y, int z) {
		return ((long) (x & 0xfffff) << 40) | ((long) (y & 0xfffff) << 20) | (z & 0xfffff);
	}

	public int motorCount() {
		int n = 0;
		for (Part p : parts) if (p.motor()) n++;
		return n;
	}

	private void spawnDisplay(ServerLevel level, Part part) {
		Display.BlockDisplay d = new Display.BlockDisplay(EntityTypes.BLOCK_DISPLAY, level);
		d.setBlockState(part.state);
		// Turn round the middle of the block, not its corner.
		d.setTransformation(new Transformation(new Vector3f(-0.5F, 0, -0.5F), null, null, null));
		d.setPosRotInterpolationDuration(Math.max(2, displayEvery()));
		d.addTag(DISPLAY_TAG);
		d.addTag(DISPLAY_TAG + "." + this.getStringUUID());
		Vec3 c = cellCentre(part, this.position(), this.getYRot());
		d.snapTo(c.x, c.y, c.z, this.getYRot(), 0);
		level.addFreshEntity(d);
		part.display = d;
	}

	/** Where a block's centre (bottom) is, with the raft at pos, turned yaw. */
	private static Vec3 cellCentre(Part part, Vec3 pos, float yaw) {
		return pos.add(new Vec3(part.ox, part.oy, part.oz).yRot(-yaw * Mth.DEG_TO_RAD));
	}

	private void placeDisplays() {
		for (Part p : parts) {
			if (p.display == null || p.display.isRemoved()) continue;
			Vec3 c = cellCentre(p, this.position(), this.getYRot());
			p.display.snapTo(c.x, c.y, c.z, this.getYRot(), 0);
		}
	}

	// ------------------------------------------------------------ sailing

	@Override
	public void tick() {
		super.tick();
		if (!(this.level() instanceof ServerLevel level)) return;
		if (restored) {
			// Loaded from a save: put the blocks back where they are (and clear away the old displays).
			for (var d : level.getEntities(EntityTypes.BLOCK_DISPLAY, this.getBoundingBox().inflate(16), d -> d.entityTags().contains(DISPLAY_TAG + "." + this.getStringUUID()))) d.discard();
			moor(level);
			return;
		}
		Player driver = this.getFirstPassenger() instanceof Player p ? p : null;
		if (driver == null && testInput == null) {
			moor(level);
			return;
		}
		Water.Input in = testInput != null ? testInput : Water.Input.NONE;
		if (driver instanceof ServerPlayer sp) {
			var ci = sp.getLastClientInput();
			in = new Water.Input((ci.forward() ? 1 : 0) - (ci.backward() ? 1 : 0), (ci.left() ? 1 : 0) - (ci.right() ? 1 : 0));
		}
		List<MotorSpec> running = new ArrayList<>();
		for (Part p : parts) if (p.motor() && p.fuel > 0) running.add(((MotorBlock) p.state.getBlock()).motor());
		Water.Vessel v = Water.vessel(running, 4 + parts.size());
		Water.State s0 = state;
		s0.yaw = heading();
		Water.State s = Water.step(s0, in, v, new Water.Env(true, !running.isEmpty()));
		double nx = this.getX() + s.vx, nz = this.getZ() + s.vz;
		float turned = (float) (s.yaw - heading0);
		String blocked = check(level, nx, nz, turned);
		if (blocked != null) {
			// Try going on without turning, then turning on the spot.
			if (check(level, nx, nz, this.getYRot()) == null) {
				turned = this.getYRot();
				s.yaw = heading();
				blocked = null;
			} else if (check(level, this.getX(), this.getZ(), turned) == null) {
				nx = this.getX();
				nz = this.getZ();
				s.speed = 0;
				blocked = null;
			} else {
				s.speed = 0;
			}
		}
		if (blocked != null) {
			s.yaw = heading();
			if (this.tickCount - blockedAt > 30) {
				blockedAt = this.tickCount;
				level.playSound(null, this.blockPosition(), SoundEvents.WOOD_HIT, SoundSource.BLOCKS, 1F, 0.6F);
				if (driver instanceof ServerPlayer sp) {
					sp.sendOverlayMessage(Component.translatable("outboards.raft." + blocked));
					hudAfter = this.tickCount + 40;
				}
			}
		} else {
			this.yRotO = this.getYRot();
			this.setPos(nx, this.getY(), nz);
			this.setYRot(turned);
		}
		if (this.tickCount % displayEvery() == 0) placeDisplays();
		state = s;

		// Fuel
		double tank = 0, fuel = 0;
		for (Part p : parts) {
			if (!p.motor()) continue;
			MotorSpec m = ((MotorBlock) p.state.getBlock()).motor();
			if (p.fuel > 0) {
				p.fuel = Math.max(0, p.fuel - s.burn * m.burn);
				if (p.fuel <= 0 && driver instanceof ServerPlayer sp) {
					sp.sendOverlayMessage(Component.translatable("outboards.empty"));
					hudAfter = this.tickCount + 60;
				}
			}
			tank += m.tank;
			fuel += p.fuel;
		}
		boolean loud = false, big = false;
		for (MotorSpec m : running) {
			loud |= !m.silent;
			big |= m.inboard;
		}
		if (loud && Math.abs(s.throttle) > 0.01 && this.tickCount % 6 == 0) {
			// An inboard engine is a deep, loud rumble.
			double t = Math.abs(s.throttle);
			level.playSound(null, this.blockPosition(), SoundEvents.BEE_LOOP, SoundSource.NEUTRAL,
				(float) (big ? 0.8 + 0.6 * t : 0.3 + 0.5 * t), (float) (big ? 0.5 + 0.25 * t : 0.4 + 0.5 * t));
		}
		if (driver instanceof ServerPlayer sp && this.tickCount % 5 == 0 && this.tickCount > hudAfter) {
			Component throttle = s.throttle < -0.01 ? Component.translatable("outboards.hud.reverse") : Component.literal(Math.round(s.throttle * 100) + "%");
			sp.sendOverlayMessage(Component.translatable("outboards.hud.raft", Fuel.kmh(s.speed), throttle, Fuel.percent(fuel, tank), parts.size()));
		}
	}

	private static boolean open(@Nullable String id) {
		return id != null && (id.equals("minecraft:air") || id.equals("minecraft:cave_air") || Water.WATERY.matcher(id).matches());
	}

	/** Null if the raft fits there and floats, or why not: "blocked" or "aground". */
	private @Nullable String check(ServerLevel level, double x, double z, float yaw) {
		Vec3 at = new Vec3(x, this.getY(), z);
		int bottoms = 0, wet = 0;
		for (Part p : parts) {
			Vec3 c = cellCentre(p, at, yaw);
			BlockPos pos = BlockPos.containing(c.x, c.y + 0.5, c.z);
			if (!open(idAt(level, pos))) return "blocked";
			if (!columnsBelow.contains(key(p.ox, p.oy - 1, p.oz))) {
				bottoms++;
				if (Water.WATERY.matcher(String.valueOf(idAt(level, pos.below()))).matches()) wet++;
			}
		}
		return wet >= bottoms / 2.0 ? null : "aground";
	}

	// ------------------------------------------------------------ mooring

	/** Puts the raft down as blocks again, turned to the nearest quarter, and lets everyone off. */
	public void moor(ServerLevel level) {
		if (moored) return;
		moored = true;
		int k = Math.floorMod(Math.round(this.getYRot() / 90F), 4);
		Rotation rotation = switch (k) {
			case 1 -> Rotation.CLOCKWISE_90;
			case 2 -> Rotation.CLOCKWISE_180;
			case 3 -> Rotation.COUNTERCLOCKWISE_90;
			default -> Rotation.NONE;
		};
		int bx = Mth.floor(this.getX()), bz = Mth.floor(this.getZ()), by = Mth.floor(this.getY() + 0.01);
		List<BlockPos> placed = new ArrayList<>();
		// Solid blocks first, then what hangs on them.
		List<Part> order = new ArrayList<>(parts);
		order.sort((a, b) -> Boolean.compare(b.state.isSolid(), a.state.isSolid()) != 0 ? Boolean.compare(b.state.isSolid(), a.state.isSolid()) : a.oy - b.oy);
		for (Part p : order) {
			int[] r = Water.rotateQuarter(p.ox, p.oz, k);
			BlockPos pos = new BlockPos(bx + r[0], by + p.oy, bz + r[1]);
			BlockState s = p.state.rotate(rotation);
			if (p.motor()) s = s.setValue(MotorBlock.FUEL, (int) Math.ceil(Math.min(MotorBlock.FUEL_MAX, p.fuel)));
			if (!open(idAt(level, pos))) {
				// Something got in the way: drop it as an item instead.
				Block.dropResources(s, level, pos);
				continue;
			}
			level.setBlock(pos, s, Block.UPDATE_CLIENTS | Block.UPDATE_KNOWN_SHAPE);
			if (p.blockEntity != null) {
				BlockEntity be = level.getBlockEntity(pos);
				if (be != null) {
					be.loadWithComponents(TagValueInput.create(ProblemReporter.DISCARDING, level.registryAccess(), p.blockEntity));
					be.setChanged();
				}
			}
			placed.add(pos);
		}
		for (BlockPos pos : placed) {
			BlockState now = level.getBlockState(pos);
			BlockState shaped = Block.updateFromNeighbourShapes(now, level, pos);
			if (shaped != now) level.setBlock(pos, shaped, Block.UPDATE_CLIENTS);
			level.updateNeighborsAt(pos, shaped.getBlock(), null);
		}
		for (Part p : parts) if (p.display != null) p.display.discard();
		for (Entity e : this.getPassengers()) if (e instanceof ServerPlayer sp) sp.sendOverlayMessage(Component.translatable("outboards.raft.moored"));
		this.ejectPassengers();
		this.discard();
	}

	@Override
	public void remove(Entity.RemovalReason reason) {
		// Killed or discarded some other way: don't lose the blocks.
		if (!moored && reason.shouldDestroy() && this.level() instanceof ServerLevel level) moor(level);
		super.remove(reason);
	}

	// ------------------------------------------------------------ passengers

	private void syncSeats() {
		StringBuilder sb = new StringBuilder();
		for (Entity e : this.getPassengers()) {
			Vec3 v = seats.getOrDefault(e.getUUID(), Vec3.ZERO);
			if (!sb.isEmpty()) sb.append(';');
			sb.append(String.format(java.util.Locale.ROOT, "%.3f,%.3f,%.3f", v.x, v.y, v.z));
		}
		this.entityData.set(SEATS, sb.toString());
	}

	@Override
	public void onSyncedDataUpdated(EntityDataAccessor<?> accessor) {
		super.onSyncedDataUpdated(accessor);
		if (SEATS.equals(accessor)) {
			List<Vec3> list = new ArrayList<>();
			for (String s : this.entityData.get(SEATS).split(";")) {
				String[] xyz = s.split(",");
				if (xyz.length == 3) list.add(new Vec3(Double.parseDouble(xyz[0]), Double.parseDouble(xyz[1]), Double.parseDouble(xyz[2])));
			}
			clientSeats = list;
		}
		if (WIDTH.equals(accessor) || HEIGHT.equals(accessor)) this.refreshDimensions();
	}

	@Override
	protected void addPassenger(Entity passenger) {
		super.addPassenger(passenger);
		if (!this.level().isClientSide()) syncSeats();
	}

	@Override
	protected void removePassenger(Entity passenger) {
		super.removePassenger(passenger);
		if (!this.level().isClientSide()) {
			seats.remove(passenger.getUUID());
			syncSeats();
		}
	}

	private Vec3 seatOf(Entity passenger) {
		if (!this.level().isClientSide()) return seats.getOrDefault(passenger.getUUID(), Vec3.ZERO);
		int i = this.getPassengers().indexOf(passenger);
		return i >= 0 && i < clientSeats.size() ? clientSeats.get(i) : Vec3.ZERO;
	}

	@Override
	protected void positionRider(Entity passenger, Entity.MoveFunction moveFunction) {
		if (!this.hasPassenger(passenger)) return;
		Vec3 p = this.position().add(seatOf(passenger).yRot(-this.getYRot() * Mth.DEG_TO_RAD));
		moveFunction.accept(passenger, p.x, p.y, p.z);
		float turned = this.getYRot() - this.yRotO;
		passenger.setYRot(passenger.getYRot() + turned);
		passenger.setYHeadRot(passenger.getYHeadRot() + turned);
		if (passenger instanceof LivingEntity living) living.setYBodyRot(living.yBodyRot + turned);
	}

	@Override
	protected boolean canAddPassenger(Entity passenger) {
		return !moored;
	}

	@Override
	public Vec3 getDismountLocationForPassenger(LivingEntity passenger) {
		return passenger.position().add(0, 0.05, 0);
	}

	@Override
	public @Nullable LivingEntity getControllingPassenger() {
		return null;
	}

	/** Climb aboard where you click it. */
	@Override
	public InteractionResult interact(Player player, InteractionHand hand, Vec3 location) {
		if (moored || player.isSecondaryUseActive()) return InteractionResult.PASS;
		if (!this.level().isClientSide()) {
			Vec3 rel = player.position().subtract(this.position()).yRot(this.getYRot() * Mth.DEG_TO_RAD);
			seats.put(player.getUUID(), new Vec3(rel.x, Math.max(1, Math.round(rel.y)), rel.z));
			player.startRiding(this);
		}
		return InteractionResult.SUCCESS;
	}

	@Override
	public boolean isPickable() {
		return !this.isRemoved();
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	public EntityDimensions getDimensions(Pose pose) {
		return EntityDimensions.fixed(this.entityData.get(WIDTH), this.entityData.get(HEIGHT));
	}

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		return false;
	}

	@Override
	public boolean shouldRenderAtSqrDistance(double distance) {
		return distance < 256 * 256;
	}

	// ------------------------------------------------------------ saving

	@Override
	protected void addAdditionalSaveData(ValueOutput out) {
		CompoundTag root = new CompoundTag();
		ListTag list = new ListTag();
		for (Part p : parts) {
			CompoundTag t = new CompoundTag();
			t.put("State", NbtUtils.writeBlockState(p.state));
			if (p.blockEntity != null) t.put("BlockEntity", p.blockEntity);
			t.putIntArray("Offset", new int[] {p.ox, p.oy, p.oz});
			t.putDouble("Fuel", p.fuel);
			list.add(t);
		}
		root.put("Parts", list);
		root.putInt("Water", water);
		root.putFloat("Heading", heading0);
		out.store("Raft", CompoundTag.CODEC, root);
	}

	@Override
	protected void readAdditionalSaveData(ValueInput in) {
		in.read("Raft", CompoundTag.CODEC).ifPresent(root -> {
			parts.clear();
			var blocks = this.level().registryAccess().lookupOrThrow(Registries.BLOCK);
			for (Tag tag : root.getListOrEmpty("Parts")) {
				if (!(tag instanceof CompoundTag t)) continue;
				int[] o = t.getIntArray("Offset").orElse(new int[3]);
				Part p = new Part(NbtUtils.readBlockState(blocks, t.getCompoundOrEmpty("State")), t.getCompound("BlockEntity").orElse(null), o[0], o[1], o[2]);
				p.fuel = t.getDoubleOr("Fuel", 0);
				parts.add(p);
			}
			water = root.getIntOr("Water", 0);
			heading0 = root.getFloatOr("Heading", 0);
		});
		restored = true;
	}

	/** For the selftest. */
	public ItemStack partItem(int i) {
		return new ItemStack(parts.get(i).state.getBlock());
	}
}
