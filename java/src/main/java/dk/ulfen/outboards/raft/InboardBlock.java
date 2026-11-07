package dk.ulfen.outboards.raft;

import net.minecraft.core.BlockPos;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.Shapes;
import net.minecraft.world.phys.shapes.VoxelShape;

/**
 * The inboard engine: a whole block that goes anywhere inside a ship's hull. It is placed
 * facing the way the player looks, so its propeller (FACING) points back and the ship goes
 * the way the player looked. Fuel and casting off work as on the outboards.
 */
public class InboardBlock extends MotorBlock {
	public InboardBlock(Properties props, String motorId) {
		super(props, motorId);
	}

	@Override
	public BlockState getStateForPlacement(BlockPlaceContext ctx) {
		return this.defaultBlockState().setValue(FACING, ctx.getHorizontalDirection().getOpposite());
	}

	@Override
	protected VoxelShape getShape(BlockState state, BlockGetter level, BlockPos pos, CollisionContext ctx) {
		return Shapes.block();
	}
}
