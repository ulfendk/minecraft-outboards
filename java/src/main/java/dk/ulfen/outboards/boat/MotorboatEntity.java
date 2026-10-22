package dk.ulfen.outboards.boat;

import java.util.List;

import com.geckolib.animatable.GeoEntity;
import com.geckolib.animatable.instance.AnimatableInstanceCache;
import com.geckolib.animatable.manager.AnimatableManager;
import com.geckolib.animation.AnimationController;
import com.geckolib.animation.RawAnimation;
import com.geckolib.util.GeckoLibUtil;
import dk.ulfen.outboards.BoatSpec;
import dk.ulfen.outboards.Fuel;
import dk.ulfen.outboards.ModRegistry;
import dk.ulfen.outboards.MotorSpec;
import dk.ulfen.outboards.Water;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.tags.FluidTags;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.damagesource.DamageTypes;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityDimensions;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.vehicle.boat.AbstractBoat;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.phys.Vec3;
import org.jspecify.annotations.Nullable;

/**
 * A boat with an outboard motor clamped to its stern. The server drives it every tick with
 * {@link Water} (the same model the Bedrock add-on runs) from the driver's movement keys,
 * holds it at the water's surface, and burns fuel. Seat 0 drives. Right-click with fuel to
 * fill it up; sneak and right-click with an empty hand (or break it) to get the boat and the
 * motor back.
 */
public class MotorboatEntity extends Mob implements GeoEntity {
	private static final EntityDataAccessor<Integer> MOTOR = SynchedEntityData.defineId(MotorboatEntity.class, EntityDataSerializers.INT);
	private static final EntityDataAccessor<Float> ROTOR = SynchedEntityData.defineId(MotorboatEntity.class, EntityDataSerializers.FLOAT);
	private static final EntityDataAccessor<Float> STEER = SynchedEntityData.defineId(MotorboatEntity.class, EntityDataSerializers.FLOAT);

	public final BoatSpec spec;
	private final AnimatableInstanceCache geoCache = GeckoLibUtil.createInstanceCache(this);

	private Water.@Nullable State state;
	private double fuel;
	private double vy;
	private boolean asleep;
	private @Nullable Player greeted;
	private int hudAfter;
	private float damage;
	private int hurtTicks;
	/** Tests drive a boat without anyone in it. */
	public Water.@Nullable Input testInput;

	// Client-side animation state
	public float spin, prevSpin, rotorShown;

	public MotorboatEntity(EntityType<? extends MotorboatEntity> type, Level level) {
		super(type, level);
		this.spec = ModRegistry.boat(type);
		this.setPersistenceRequired();
		this.setNoGravity(true);
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Mob.createMobAttributes()
			.add(Attributes.MAX_HEALTH, 40)
			.add(Attributes.MOVEMENT_SPEED, 0)
			.add(Attributes.STEP_HEIGHT, 0.6)
			.add(Attributes.KNOCKBACK_RESISTANCE, 1.0)
			.add(Attributes.CAMERA_DISTANCE, 6);
	}

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		super.defineSynchedData(builder);
		builder.define(MOTOR, 1);
		builder.define(ROTOR, 0F);
		builder.define(STEER, 0F);
	}

	public int motorIndex() { return this.entityData.get(MOTOR); }
	public MotorSpec motor() { return ModRegistry.motor(motorIndex()); }
	public float rotor() { return this.entityData.get(ROTOR); }
	public float steer() { return this.entityData.get(STEER); }
	public double fuel() { return fuel; }
	public Water.State water() { return state != null ? state : Water.State.initial(this.getYRot()); }

	public void setMotor(MotorSpec m) {
		this.entityData.set(MOTOR, ModRegistry.motorIndex(m));
	}

	public void setFuel(double fuel) {
		this.fuel = fuel;
		this.asleep = false;
	}

	public @Nullable Player driver() {
		return this.getFirstPassenger() instanceof Player p ? p : null;
	}

	// ------------------------------------------------------------ fitting the motor

	/** Swaps a vanilla boat for a motorboat of the same wood with this motor; null if it can't. */
	public static @Nullable MotorboatEntity fit(ServerLevel level, AbstractBoat boat, MotorSpec motor) {
		String item = BuiltInRegistries.ITEM.getKey(boat.getPickResult().getItem()).getPath();
		BoatSpec s = ModRegistry.boatForItem(item);
		if (s == null) return null;
		MotorboatEntity m = ModRegistry.boatType(s).create(level, EntitySpawnReason.SPAWN_ITEM_USE);
		if (m == null) return null;
		List<Entity> riders = List.copyOf(boat.getPassengers());
		boat.ejectPassengers();
		m.snapTo(boat.getX(), boat.getY(), boat.getZ(), boat.getYRot(), 0);
		m.setYBodyRot(boat.getYRot());
		m.setYHeadRot(boat.getYRot());
		m.state = Water.State.initial(boat.getYRot());
		m.setMotor(motor);
		boat.discard();
		level.addFreshEntity(m);
		for (Entity r : riders) r.startRiding(m);
		level.playSound(null, m.blockPosition(), SoundEvents.ANVIL_USE, SoundSource.NEUTRAL, 0.5F, 1.4F);
		return m;
	}

	/** Back to a boat and a motor (both dropped as items). */
	public void breakApart(ServerLevel level) {
		this.ejectPassengers();
		var boatItem = BuiltInRegistries.ITEM.getValue(Identifier.withDefaultNamespace(spec.item));
		this.spawnAtLocation(level, new ItemStack(boatItem));
		this.spawnAtLocation(level, new ItemStack(ModRegistry.MOTOR_ITEMS.get(motor().id)));
		this.playSound(SoundEvents.WOOD_BREAK, 1.0F, 0.8F);
		this.discard();
	}

	// ------------------------------------------------------------ driving

	@Override
	public void tick() {
		if (this.level().isClientSide()) {
			prevSpin = spin;
			rotorShown += (rotor() - rotorShown) * 0.1F;
			spin = (spin + rotorShown * 108F) % 360F;
			if (spin < prevSpin) prevSpin -= 360F;
		}
		super.tick();
		if (hurtTicks > 0) hurtTicks--;
		else if (damage > 0) damage = Math.max(0, damage - 1.0F);
		this.yBodyRot = this.yHeadRot = this.getYRot();
		if (this.level() instanceof ServerLevel level) drive(level);
	}

	@Override
	public void travel(Vec3 input) {
	}

	private Water.Input input(@Nullable Player driver) {
		if (driver instanceof ServerPlayer sp) {
			var in = sp.getLastClientInput();
			return new Water.Input((in.forward() ? 1 : 0) - (in.backward() ? 1 : 0), (in.left() ? 1 : 0) - (in.right() ? 1 : 0));
		}
		return testInput != null ? testInput : Water.Input.NONE;
	}

	private boolean water(BlockPos p) {
		return this.level().getFluidState(p).is(FluidTags.WATER);
	}

	/** The top of the water the hull floats in, or NaN when there is none (see waterSurface in util.js). */
	private double surface() {
		int top = Integer.MIN_VALUE;
		for (int by = Mth.floor(this.getY() + 0.6); by >= Mth.floor(this.getY() - 1); by--) {
			if (water(BlockPos.containing(this.getX(), by, this.getZ()))) { top = by; break; }
		}
		if (top == Integer.MIN_VALUE) return Double.NaN;
		for (int i = 0; i < 4 && water(BlockPos.containing(this.getX(), top + 1, this.getZ())); i++) top++;
		return top + 1;
	}

	private void drive(ServerLevel level) {
		Player driver = driver();
		double surface = surface();
		boolean afloat = !Double.isNaN(surface) && this.getY() < surface + 0.3;
		double target = surface - 0.3;
		Water.Input in = input(driver);
		if (state == null) state = Water.State.initial(this.getYRot());
		if (driver == null && testInput == null && state.speed == 0 && state.throttle == 0 && !Double.isNaN(surface) && Math.abs(target - this.getY()) < 0.03) {
			if (!asleep) {
				asleep = true;
				this.setDeltaMovement(Vec3.ZERO);
				this.entityData.set(ROTOR, 0F);
				this.entityData.set(STEER, 0F);
			}
			return;
		}
		asleep = false;
		MotorSpec motor = motor();
		boolean hadFuel = fuel > 0;
		Water.State s = Water.step(state, in, Water.vessel(List.of(motor), Water.BOAT_MASS), new Water.Env(afloat, hadFuel));
		state = s;
		fuel = Math.max(0, fuel - s.burn * motor.burn);
		if (hadFuel && fuel <= 0 && driver instanceof ServerPlayer sp) {
			sp.sendOverlayMessage(Component.translatable("outboards.empty"));
			hudAfter = this.tickCount + 60;
		}
		if (!Double.isNaN(surface)) vy = Mth.clamp((target - this.getY()) * 0.3, -0.2, 0.2);
		else vy = this.onGround() ? 0 : Math.max(-0.8, vy - 0.04);
		Vec3 v = new Vec3(s.vx, vy, s.vz);
		this.setDeltaMovement(v);
		this.move(MoverType.SELF, v);
		this.setYRot((float) s.yaw);
		this.yRotO = this.getYRot();
		this.yBodyRot = this.yHeadRot = this.getYRot();
		this.resetFallDistance();

		boolean running = fuel > 0 && Math.abs(s.throttle) > 0.01;
		this.entityData.set(ROTOR, running ? (float) Math.min(1, 0.25 + Math.abs(s.throttle)) : 0F);
		this.entityData.set(STEER, (float) (in.side() * 22));
		if (running && !motor.silent && this.tickCount % 6 == 0) {
			level.playSound(null, this.blockPosition(), SoundEvents.BEE_LOOP, SoundSource.NEUTRAL,
				(float) (0.25 + 0.4 * Math.abs(s.throttle)), (float) (0.5 + 0.6 * Math.abs(s.throttle)));
		}
		if (driver instanceof ServerPlayer sp) {
			if (this.tickCount % 5 == 0 && this.tickCount > hudAfter) {
				Component throttle = s.throttle < -0.01 ? Component.translatable("outboards.hud.reverse") : Component.literal(Math.round(s.throttle * 100) + "%");
				sp.sendOverlayMessage(Component.translatable(motor.electric() ? "outboards.hud.electric" : "outboards.hud",
					Fuel.kmh(s.speed), throttle, Fuel.percent(fuel, motor.tank)));
			}
			if (greeted != sp) {
				greeted = sp;
				sp.sendSystemMessage(Component.empty().append(this.getName().copy().withStyle(ChatFormatting.YELLOW))
					.append(": ").append(Component.translatable("outboards.controls.java.boat")));
			}
		}
		if (driver == null) greeted = null;
	}

	// ------------------------------------------------------------ no AI, no despawn, no death drops

	@Override
	protected void registerGoals() {
	}

	@Override
	public boolean removeWhenFarAway(double distSqr) {
		return false;
	}

	@Override
	public boolean requiresCustomPersistence() {
		return true;
	}

	@Override
	public boolean causeFallDamage(double fallDistance, float damageModifier, DamageSource damageSource) {
		return false;
	}

	@Override
	protected void checkFallDamage(double ya, boolean onGround, BlockState onState, BlockPos pos) {
	}

	@Override
	public boolean canBreatheUnderwater() {
		return true;
	}

	@Override
	public boolean isAffectedByPotions() {
		return false;
	}

	@Override
	public boolean canBeLeashed() {
		return false;
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	public boolean canBeCollidedWith(@Nullable Entity other) {
		return other == null || !other.isPassengerOfSameVehicle(this);
	}

	@Override
	protected boolean shouldDropLoot(ServerLevel level) {
		return false;
	}

	// ------------------------------------------------------------ breaking (players only, like boats)

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		if (this.isRemoved()) return true;
		if (source.is(DamageTypes.GENERIC_KILL) || source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) {
			this.discard();
			return true;
		}
		if (!(source.getEntity() instanceof Player player) || this.hasPassenger(player)) return false;
		if (player.getAbilities().instabuild) {
			breakApart(level);
			return true;
		}
		this.hurtTicks = 10;
		this.damage += Math.max(1.0F, amount) * 10.0F;
		this.playSound(SoundEvents.WOOD_HIT, 0.8F, 1.0F);
		if (this.damage > 40.0F) breakApart(level);
		return true;
	}

	// ------------------------------------------------------------ riding, refuelling

	@Override
	public InteractionResult interact(Player player, InteractionHand hand, Vec3 location) {
		ItemStack stack = player.getItemInHand(hand);
		if (Fuel.isFuel(stack)) {
			if (this.level().isClientSide()) return InteractionResult.SUCCESS;
			Double next = Fuel.refuel(player, stack, motor(), fuel);
			if (next != null) setFuel(next);
			return InteractionResult.SUCCESS_SERVER;
		}
		if (player.isSecondaryUseActive()) {
			if (!stack.isEmpty()) return InteractionResult.PASS;
			if (this.level() instanceof ServerLevel level) {
				breakApart(level);
				player.sendOverlayMessage(Component.translatable("outboards.detached"));
			}
			return InteractionResult.SUCCESS;
		}
		if (this.getPassengers().size() >= spec.seats.size()) return InteractionResult.PASS;
		if (!this.level().isClientSide()) player.startRiding(this);
		return InteractionResult.SUCCESS;
	}

	@Override
	protected boolean canAddPassenger(Entity passenger) {
		return this.getPassengers().size() < spec.seats.size();
	}

	@Override
	public @Nullable LivingEntity getControllingPassenger() {
		return null;
	}

	public Vec3 seat(int i) {
		double[] at = spec.seats.get(Math.min(Math.max(0, i), spec.seats.size() - 1));
		return new Vec3(at[0], at[1], at[2]).yRot(-this.getYRot() * Mth.DEG_TO_RAD);
	}

	@Override
	protected Vec3 getPassengerAttachmentPoint(Entity passenger, EntityDimensions dimensions, float scale) {
		return seat(this.getPassengers().indexOf(passenger));
	}

	@Override
	protected void positionRider(Entity passenger, Entity.MoveFunction moveFunction) {
		super.positionRider(passenger, moveFunction);
		float turned = this.getYRot() - this.yRotO;
		passenger.setYRot(passenger.getYRot() + turned);
		passenger.setYHeadRot(passenger.getYHeadRot() + turned);
		if (passenger instanceof LivingEntity living) living.setYBodyRot(living.yBodyRot + turned);
	}

	@Override
	public Vec3 getDismountLocationForPassenger(LivingEntity passenger) {
		Vec3 side = new Vec3(this.getBbWidth() * 0.5 + 0.7, 0, 0).yRot(-this.getYRot() * Mth.DEG_TO_RAD);
		Vec3 rel = passenger.position().subtract(this.position());
		Vec3 pos = this.position().add(rel.dot(side) >= 0 ? side : side.scale(-1));
		return new Vec3(pos.x, this.getY() + 0.2, pos.z);
	}

	// ------------------------------------------------------------ saving

	@Override
	protected void addAdditionalSaveData(ValueOutput out) {
		super.addAdditionalSaveData(out);
		out.putInt("Motor", motorIndex());
		out.putDouble("Fuel", fuel);
	}

	@Override
	protected void readAdditionalSaveData(ValueInput in) {
		super.readAdditionalSaveData(in);
		this.entityData.set(MOTOR, in.getIntOr("Motor", 1));
		fuel = in.getDoubleOr("Fuel", 0);
		state = null;
	}

	// ------------------------------------------------------------ GeckoLib

	@Override
	public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
		RawAnimation move = RawAnimation.begin().thenLoop("animation.outboards." + spec.id + ".move");
		controllers.add(new AnimationController<>("move", 0, state -> state.setAndContinue(move)));
	}

	@Override
	public AnimatableInstanceCache getAnimatableInstanceCache() {
		return geoCache;
	}
}
