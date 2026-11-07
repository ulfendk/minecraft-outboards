package dk.ulfen.outboards;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.ItemUtils;
import net.minecraft.world.item.Items;
import org.jspecify.annotations.Nullable;

/** Filling up a motor from the item in a player's hand (the same rules as the Bedrock add-on). */
public final class Fuel {
	private Fuel() {}

	public static String id(ItemStack stack) {
		return BuiltInRegistries.ITEM.getKey(stack.getItem()).toString();
	}

	/** Is this fuel for any motor? (Then using it on a motor fills it, rather than boarding.) */
	public static boolean isFuel(ItemStack stack) {
		if (stack.isEmpty()) return false;
		String id = id(stack);
		for (MotorSpec m : ModRegistry.MOTORS) if (m.fuels.containsKey(id)) return true;
		return false;
	}

	/** Puts the held fuel into the tank: the new fuel level, or null when nothing went in. */
	public static @Nullable Double refuel(Player player, ItemStack stack, MotorSpec motor, double fuel) {
		Integer units = motor.fuels.get(id(stack));
		if (units == null) {
			player.sendOverlayMessage(Component.translatable("outboards.wrong_fuel." + motor.kind));
			return null;
		}
		if (fuel + 0.5 >= motor.tank) {
			player.sendOverlayMessage(Component.translatable("outboards.tank_full"));
			return null;
		}
		double next = Math.min(motor.tank, fuel + units);
		boolean lava = stack.is(Items.LAVA_BUCKET);
		if (lava && !player.hasInfiniteMaterials()) {
			// The lava goes in the tank; the bucket stays with the player.
			InteractionHand hand = player.getMainHandItem() == stack ? InteractionHand.MAIN_HAND : InteractionHand.OFF_HAND;
			player.setItemInHand(hand, ItemUtils.createFilledResult(stack, player, new ItemStack(Items.BUCKET)));
		} else {
			stack.consume(1, player);
		}
		player.level().playSound(null, player.blockPosition(), motor.electric() ? SoundEvents.EXPERIENCE_ORB_PICKUP : lava ? SoundEvents.BUCKET_EMPTY_LAVA : SoundEvents.BUCKET_FILL,
			SoundSource.PLAYERS, 0.7F, motor.electric() ? 1.6F : 0.8F);
		player.sendOverlayMessage(Component.translatable("outboards.refuel", percent(next, motor.tank)));
		return next;
	}

	public static String percent(double fuel, double tank) {
		return Math.round(100 * Math.max(0, fuel) / tank) + "%";
	}

	public static String kmh(double blocksPerTick) {
		return String.valueOf(Math.round(Math.abs(blocksPerTick) * 72));
	}
}
