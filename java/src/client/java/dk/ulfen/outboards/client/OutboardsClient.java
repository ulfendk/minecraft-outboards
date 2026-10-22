package dk.ulfen.outboards.client;

import com.geckolib.model.DefaultedEntityGeoModel;
import com.geckolib.renderer.GeoEntityRenderer;
import dk.ulfen.outboards.ModRegistry;
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.client.renderer.entity.EntityRenderers;
import net.minecraft.client.renderer.entity.NoopRenderer;

public class OutboardsClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		OutboardsMolang.register();
		for (var spec : ModRegistry.BOATS) {
			EntityRenderers.register(ModRegistry.boatType(spec), ctx -> {
				var r = new GeoEntityRenderer<>(ctx, new DefaultedEntityGeoModel<>(ModRegistry.id(spec.id)));
				r.withScale(1F);
				return r;
			});
		}
		// A raft is drawn by the block displays it moves; the entity itself is invisible.
		EntityRenderers.register(ModRegistry.RAFT, NoopRenderer::new);
	}
}
