package dk.ulfen.outboards.raft;

import dk.ulfen.outboards.ModRegistry;
import dk.ulfen.outboards.Water;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;
import org.jspecify.annotations.Nullable;

/**
 * The inboard engine: 2 blocks wide, 2 high and 6 long (Water.ENGINE), all of this block, each
 * knowing which part of the engine it is (PX across, PY up, PZ from the aft end forwards). It
 * is built ahead of the player who places it, its propeller end (FACING) towards them, so the
 * ship goes the way they looked. Part 0,0,0 keeps the fuel and counts as the motor; using any
 * part uses that one, and breaking any part takes the whole engine away and gives one back.
 */
public class InboardBlock extends MotorBlock {
	public static final IntegerProperty PX = IntegerProperty.create("px", 0, Water.ENGINE[0] - 1);
	public static final IntegerProperty PY = IntegerProperty.create("py", 0, Water.ENGINE[1] - 1);
	public static final IntegerProperty PZ = IntegerProperty.create("pz", 0, Water.ENGINE[2] - 1);

	public InboardBlock(Properties props, String motorId) {
		super(props, motorId);
	}

	@Override
	protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
		super.createBlockStateDefinition(builder);
		builder.add(PX, PY, PZ);
	}

	/** Only part 0,0,0 is the motor (the rest is engine). */
	@Override
	public boolean drives(BlockState state) {
		return state.getValue(PX) == 0 && state.getValue(PY) == 0 && state.getValue(PZ) == 0;
	}

	private static BlockPos offset(BlockPos at, int px, int py, int pz, Direction facing, int sign) {
		int[] o = Water.engineOffset(px, py, pz, facing.getSerializedName());
		return at.offset(sign * o[0], sign * o[1], sign * o[2]);
	}

	/** Where part 0,0,0 of the engine this block belongs to is. */
	public BlockPos head(BlockState state, BlockPos pos) {
		return offset(pos, state.getValue(PX), state.getValue(PY), state.getValue(PZ), state.getValue(FACING), -1);
	}

	/** Builds a whole engine with part 0,0,0 at `at`; false (and nothing built) when there is no room. */
	public boolean build(Level level, BlockPos at, Direction facing, int fuel, boolean check) {
		if (check && !room(level, at, facing)) return false;
		for (int px = 0; px < Water.ENGINE[0]; px++)
			for (int py = 0; py < Water.ENGINE[1]; py++)
				for (int pz = 0; pz < Water.ENGINE[2]; pz++) {
					BlockState s = this.defaultBlockState().setValue(FACING, facing).setValue(PX, px).setValue(PY, py).setValue(PZ, pz)
						.setValue(FUEL, px == 0 && py == 0 && pz == 0 ? fuel : 0);
					level.setBlock(offset(at, px, py, pz, facing, 1), s, Block.UPDATE_ALL);
				}
		return true;
	}

	private static boolean room(Level level, BlockPos at, Direction facing) {
		for (int px = 0; px < Water.ENGINE[0]; px++)
			for (int py = 0; py < Water.ENGINE[1]; py++)
				for (int pz = 0; pz < Water.ENGINE[2]; pz++) {
					BlockPos p = offset(at, px, py, pz, facing, 1);
					if (!(px == 0 && py == 0 && pz == 0) && !level.getBlockState(p).canBeReplaced()) return false;
				}
		return true;
	}

	@Override
	public @Nullable BlockState getStateForPlacement(BlockPlaceContext ctx) {
		Direction facing = ctx.getHorizontalDirection().getOpposite();
		if (!room(ctx.getLevel(), ctx.getClickedPos(), facing)) {
			if (ctx.getPlayer() != null && !ctx.getLevel().isClientSide()) ctx.getPlayer().sendOverlayMessage(Component.translatable("outboards.engine_no_room"));
			return null;
		}
		return this.defaultBlockState().setValue(FACING, facing);
	}

	@Override
	public void setPlacedBy(Level level, BlockPos pos, BlockState state, @Nullable LivingEntity placer, ItemStack stack) {
		if (level.isClientSide()) return;
		build(level, pos, state.getValue(FACING), 0, false);
		if (placer instanceof Player p) p.sendOverlayMessage(Component.translatable("outboards.inboard_placed"));
	}

	@Override
	public BlockState playerWillDestroy(Level level, BlockPos pos, BlockState state, Player player) {
		if (!level.isClientSide()) {
			BlockPos head = head(state, pos);
			Direction facing = state.getValue(FACING);
			for (int px = 0; px < Water.ENGINE[0]; px++)
				for (int py = 0; py < Water.ENGINE[1]; py++)
					for (int pz = 0; pz < Water.ENGINE[2]; pz++) {
						BlockPos p = offset(head, px, py, pz, facing, 1);
						if (!p.equals(pos) && level.getBlockState(p).is(this)) level.setBlock(p, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL | Block.UPDATE_SUPPRESS_DROPS);
					}
			if (!player.hasInfiniteMaterials()) Block.popResource(level, pos, new ItemStack(ModRegistry.MOTOR_ITEMS.get(motorId)));
		}
		return super.playerWillDestroy(level, pos, state, player);
	}

	@Override
	protected InteractionResult useItemOn(ItemStack stack, BlockState state, Level level, BlockPos pos, Player player, InteractionHand hand, BlockHitResult hit) {
		BlockPos head = head(state, pos);
		BlockState hs = level.getBlockState(head);
		if (!hs.is(this)) return InteractionResult.PASS;
		return super.useItemOn(stack, hs, level, head, player, hand, hit);
	}

	@Override
	protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
		BlockPos head = head(state, pos);
		BlockState hs = level.getBlockState(head);
		if (!hs.is(this)) return InteractionResult.PASS;
		return super.useWithoutItem(hs, level, head, player, hit);
	}

	@Override
	protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext ctx) {
		return Shapes.block();
	}
}
