package dk.ulfen.outboards;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import dk.ulfen.outboards.boat.MotorboatEntity;
import dk.ulfen.outboards.raft.HelmBlock;
import dk.ulfen.outboards.raft.MotorBlock;
import dk.ulfen.outboards.raft.MotorItem;
import dk.ulfen.outboards.raft.RaftEntity;
import net.fabricmc.fabric.api.creativetab.v1.FabricCreativeModeTab;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;

/** Everything the mod adds to the game registries. */
public final class ModRegistry {
	public static List<MotorSpec> MOTORS = List.of();
	public static List<BoatSpec> BOATS = List.of();
	public static final Map<String, EntityType<MotorboatEntity>> BOAT_TYPES = new LinkedHashMap<>();
	private static final Map<EntityType<?>, BoatSpec> BOAT_BY_TYPE = new HashMap<>();
	private static final Map<String, BoatSpec> BOAT_BY_ITEM = new HashMap<>();
	/** motor id -> its item, and the block it becomes on a raft. */
	public static final Map<String, Item> MOTOR_ITEMS = new LinkedHashMap<>();
	public static final Map<String, MotorBlock> MOTOR_BLOCKS = new LinkedHashMap<>();

	public static EntityType<RaftEntity> RAFT;
	public static HelmBlock HELM;
	public static Item HELM_ITEM;
	public static Item HANDBOOK;

	private ModRegistry() {}

	public static Identifier id(String path) {
		return Identifier.fromNamespaceAndPath(Outboards.MOD_ID, path);
	}

	public static MotorSpec motor(String id) {
		for (MotorSpec m : MOTORS) if (m.id.equals(id)) return m;
		throw new IllegalArgumentException("no motor " + id);
	}

	/** Motors are numbered 1..4 on the motorboat (0: none), the same as on Bedrock. */
	public static MotorSpec motor(int index) {
		return MOTORS.get(Math.max(0, Math.min(MOTORS.size() - 1, index - 1)));
	}

	public static int motorIndex(MotorSpec m) {
		return MOTORS.indexOf(m) + 1;
	}

	public static BoatSpec boat(EntityType<?> type) {
		BoatSpec s = BOAT_BY_TYPE.get(type);
		if (s == null) throw new IllegalStateException("no motorboat spec for " + type);
		return s;
	}

	/** The motorboat a vanilla boat item ("oak_boat") becomes, if any. */
	public static BoatSpec boatForItem(String item) {
		return BOAT_BY_ITEM.get(item);
	}

	public static EntityType<MotorboatEntity> boatType(BoatSpec s) {
		return BOAT_TYPES.get(s.id);
	}

	static void register() {
		MOTORS = MotorSpec.load();
		BOATS = BoatSpec.load();
		for (BoatSpec s : BOATS) {
			ResourceKey<EntityType<?>> key = ResourceKey.create(Registries.ENTITY_TYPE, id(s.id));
			EntityType<MotorboatEntity> type = EntityType.Builder.<MotorboatEntity>of(MotorboatEntity::new, MobCategory.MISC)
				.sized(1.375F, 0.5625F)
				.clientTrackingRange(10)
				.updateInterval(1)
				.build(key);
			BOAT_BY_TYPE.put(type, s);
			BOAT_BY_ITEM.put(s.item, s);
			Registry.register(BuiltInRegistries.ENTITY_TYPE, key, type);
			BOAT_TYPES.put(s.id, type);
			FabricDefaultAttributeRegistry.register(type, MotorboatEntity.createAttributes());
		}

		ResourceKey<EntityType<?>> raftKey = ResourceKey.create(Registries.ENTITY_TYPE, id("raft"));
		RAFT = Registry.register(BuiltInRegistries.ENTITY_TYPE, raftKey, EntityType.Builder.<RaftEntity>of(RaftEntity::new, MobCategory.MISC)
			.sized(1F, 1F).clientTrackingRange(16).updateInterval(1).build(raftKey));

		for (MotorSpec m : MOTORS) {
			ResourceKey<Block> key = ResourceKey.create(Registries.BLOCK, id(m.id + "_mounted"));
			MotorBlock block = Registry.register(BuiltInRegistries.BLOCK, key, new MotorBlock(BlockBehaviour.Properties.of()
				.setId(key).mapColor(MapColor.METAL).strength(0.6F).sound(SoundType.METAL).noOcclusion(), m.id));
			MOTOR_BLOCKS.put(m.id, block);
			MOTOR_ITEMS.put(m.id, item(m.id, p -> new MotorItem(block, p, m.id), new Item.Properties().stacksTo(1)));
		}
		ResourceKey<Block> helmKey = ResourceKey.create(Registries.BLOCK, id("helm"));
		HELM = Registry.register(BuiltInRegistries.BLOCK, helmKey, new HelmBlock(BlockBehaviour.Properties.of()
			.setId(helmKey).mapColor(MapColor.WOOD).strength(1.0F).sound(SoundType.WOOD).noOcclusion()));
		HELM_ITEM = item("helm", p -> new BlockItem(HELM, p), new Item.Properties().useBlockDescriptionPrefix().stacksTo(16));
		HANDBOOK = item("outboard_handbook", HandbookItem::new, new Item.Properties().stacksTo(1));

		CreativeModeTab tab = FabricCreativeModeTab.builder()
			.title(Component.translatable("itemGroup.outboards"))
			.icon(() -> new ItemStack(MOTOR_ITEMS.get("medium_motor")))
			.displayItems((params, out) -> {
				MOTOR_ITEMS.values().forEach(out::accept);
				out.accept(HELM_ITEM);
				out.accept(HANDBOOK);
			})
			.build();
		Registry.register(BuiltInRegistries.CREATIVE_MODE_TAB, ResourceKey.create(Registries.CREATIVE_MODE_TAB, id("outboards")), tab);
	}

	private static <T extends Item> T item(String name, Function<Item.Properties, T> factory, Item.Properties props) {
		ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, id(name));
		return Registry.register(BuiltInRegistries.ITEM, key, factory.apply(props.setId(key)));
	}
}
