package dk.ulfen.outboards;

import java.util.ArrayList;
import java.util.List;

import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.Filterable;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.WrittenBookContent;
import net.minecraft.world.level.Level;

/** The Outboard Handbook: boats, rafts, fuel and a page per motor, in the reader's language. */
public class HandbookItem extends Item {
	private static final String GIVEN = "outboards.handbook_given";

	public HandbookItem(Item.Properties props) {
		super(props.component(DataComponents.WRITTEN_BOOK_CONTENT, content()));
	}

	private static Filterable<Component> page(Component title, Component... body) {
		var c = Component.empty().append(title.copy().withStyle(ChatFormatting.BOLD));
		for (Component b : body) c.append("\n\n").append(b);
		return Filterable.passThrough(c);
	}

	private static WrittenBookContent content() {
		List<Filterable<Component>> pages = new ArrayList<>();
		pages.add(page(Component.translatable("outboards.handbook.title"), Component.translatable("outboards.handbook.intro")));
		for (String p : new String[] {"boat", "raft"}) {
			pages.add(page(Component.translatable("outboards.handbook." + p), Component.translatable("outboards.handbook." + p + "_text")));
			pages.add(page(Component.translatable("outboards.handbook." + p), Component.translatable("outboards.controls.java." + p)));
		}
		pages.add(page(Component.translatable("outboards.handbook.fuel"), Component.translatable("outboards.handbook.fuel_text")));
		for (MotorSpec m : ModRegistry.MOTORS) {
			long top = Math.round(Water.topSpeed(Water.vessel(List.of(m), Water.BOAT_MASS)) * 72);
			pages.add(page(Component.translatable("item.outboards." + m.id), Component.translatable("outboards.info." + m.id),
				Component.translatable("outboards.handbook.speed", top)));
		}
		return new WrittenBookContent(Filterable.passThrough("Outboard Handbook"), "Outboards", 0, pages, true);
	}

	@Override
	public InteractionResult use(Level level, Player player, InteractionHand hand) {
		if (player instanceof ServerPlayer sp) sp.openItemGui(player.getItemInHand(hand), hand);
		return InteractionResult.SUCCESS;
	}

	/** Gives a player the handbook the first time they join a world with the mod. */
	public static void giveOnce(ServerPlayer player) {
		if (player.entityTags().contains(GIVEN)) return;
		player.addTag(GIVEN);
		player.getInventory().add(new ItemStack(ModRegistry.HANDBOOK));
		player.sendSystemMessage(Component.translatable("outboards.handbook.welcome"));
	}
}
