package dk.ulfen.outboards.raft;

import net.minecraft.world.item.BlockItem;
import net.minecraft.world.level.block.Block;

/**
 * An outboard motor. Use it on the side of a raft to clamp it on there (it becomes a
 * {@link MotorBlock}); use it on a boat to make a motorboat (see Outboards#onInitialize).
 */
public class MotorItem extends BlockItem {
	public final String motorId;

	public MotorItem(Block block, Properties props, String motorId) {
		super(block, props);
		this.motorId = motorId;
	}
}
