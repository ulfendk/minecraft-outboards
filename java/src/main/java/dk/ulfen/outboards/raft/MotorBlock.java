package dk.ulfen.outboards.raft;

import dk.ulfen.outboards.Fuel;
import dk.ulfen.outboards.ModRegistry;
import dk.ulfen.outboards.MotorSpec;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Mirror;
import net.minecraft.world.level.block.Rotation;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.EnumProperty;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * A motor clamped onto the side of a raft, in the water. FACING is where its propeller
 * points (away from the raft); FUEL is how much is in its tank (0..12, the same as the
 * Bedrock block state). Right-click it with fuel to fill it up, or empty-handed to cast off.
 */
public class MotorBlock extends Block {
	public static final EnumProperty<Direction> FACING = BlockStateProperties.HORIZONTAL_FACING;
	public static final int FUEL_MAX = 12;
	public static final IntegerProperty FUEL = IntegerProperty.create("fuel", 0, FUEL_MAX);
	private static final VoxelShape NS_SHAPE = Block.box(4, 0, 3, 12, 16, 13);
	private static final VoxelShape EW_SHAPE = Block.box(3, 0, 4, 13, 16, 12);

	public final String motorId;

	public MotorBlock(Properties props, String motorId) {
		super(props);
		this.motorId = motorId;
		this.registerDefaultState(this.stateDefinition.any().setValue(FACING, Direction.NORTH).setValue(FUEL, 0));
	}

	public MotorSpec motor() {
		return ModRegistry.motor(motorId);
	}

	/** Whether this block is a motor that drives the raft (every outboard; one block of an inboard engine). */
	public boolean drives(BlockState state) {
		return true;
	}

	@Override
	protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
		builder.add(FACING, FUEL);
	}

	/** The propeller points away from the block it is clamped to; on top of a block, the way you look. */
	@Override
	public BlockState getStateForPlacement(BlockPlaceContext ctx) {
		Direction face = ctx.getClickedFace();
		Direction facing = face.getAxis().isHorizontal() ? face : ctx.getHorizontalDirection();
		return this.defaultBlockState().setValue(FACING, facing);
	}

	@Override
	protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext ctx) {
		return state.getValue(FACING).getAxis() == Direction.Axis.Z ? NS_SHAPE : EW_SHAPE;
	}

	@Override
	protected BlockState rotate(BlockState state, Rotation rotation) {
		return state.setValue(FACING, rotation.rotate(state.getValue(FACING)));
	}

	@Override
	protected BlockState mirror(BlockState state, Mirror mirror) {
		return state.rotate(mirror.getRotation(state.getValue(FACING)));
	}

	@Override
	protected InteractionResult useItemOn(ItemStack stack, BlockState state, Level level, BlockPos pos, Player player, InteractionHand hand, BlockHitResult hit) {
		if (!Fuel.isFuel(stack)) return InteractionResult.TRY_WITH_EMPTY_HAND;
		if (level.isClientSide()) return InteractionResult.SUCCESS;
		Double next = Fuel.refuel(player, stack, motor(), state.getValue(FUEL));
		if (next != null) level.setBlock(pos, state.setValue(FUEL, (int) Math.floor(next)), Block.UPDATE_ALL);
		return InteractionResult.SUCCESS_SERVER;
	}

	@Override
	protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
		if (!(level instanceof ServerLevel server)) return InteractionResult.SUCCESS;
		if (state.getValue(FUEL) <= 0) {
			player.sendOverlayMessage(Component.translatable("outboards.empty"));
			return InteractionResult.SUCCESS_SERVER;
		}
		RaftEntity.start(server, pos, player);
		return InteractionResult.SUCCESS_SERVER;
	}
}
