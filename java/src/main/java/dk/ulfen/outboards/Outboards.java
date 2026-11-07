package dk.ulfen.outboards;

import dk.ulfen.outboards.boat.MotorboatEntity;
import dk.ulfen.outboards.raft.MotorItem;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.vehicle.boat.AbstractBoat;
import net.minecraft.world.entity.vehicle.boat.AbstractChestBoat;

public class Outboards implements ModInitializer {
	public static final String MOD_ID = "outboards";

	@Override
	public void onInitialize() {
		ModRegistry.register();
		// Everyone gets an Outboard Handbook the first time they join.
		ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> HandbookItem.giveOnce(handler.getPlayer()));
		// Using a motor on a boat clamps it on: the boat becomes a motorboat.
		UseEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
			if (!(player.getItemInHand(hand).getItem() instanceof MotorItem motor) || !(entity instanceof AbstractBoat boat)) return InteractionResult.PASS;
			if (ModRegistry.motor(motor.motorId).inboard) {
				player.sendOverlayMessage(Component.translatable("outboards.inboard_no_boat"));
				return InteractionResult.FAIL;
			}
			if (boat instanceof AbstractChestBoat) {
				player.sendOverlayMessage(Component.translatable("outboards.chest_boat"));
				return InteractionResult.FAIL;
			}
			if (level instanceof ServerLevel server) {
				if (MotorboatEntity.fit(server, boat, ModRegistry.motor(motor.motorId)) == null) return InteractionResult.FAIL;
				player.getItemInHand(hand).consume(1, player);
				player.sendOverlayMessage(Component.translatable("outboards.attached"));
			}
			return InteractionResult.SUCCESS;
		});
	}
}
