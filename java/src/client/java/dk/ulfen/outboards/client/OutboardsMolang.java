package dk.ulfen.outboards.client;

import com.geckolib.loading.math.MolangQueries;
import dk.ulfen.outboards.boat.MotorboatEntity;
import net.minecraft.util.Mth;

/** The animation variables the generated motorboat animations read (see src/lib/anim.mjs). */
public final class OutboardsMolang {
	private OutboardsMolang() {}

	public static void register() {
		MolangQueries.<Object>setActorVariable("variable.o_motor", a -> a.animatable() instanceof MotorboatEntity m ? m.motorIndex() : 1);
		MolangQueries.<Object>setActorVariable("variable.o_spin", a -> a.animatable() instanceof MotorboatEntity m ? Mth.lerp(a.partialTick(), m.prevSpin, m.spin) : 0);
		MolangQueries.<Object>setActorVariable("variable.o_rotor", a -> a.animatable() instanceof MotorboatEntity m ? m.rotorShown : 0);
		MolangQueries.<Object>setActorVariable("variable.o_steer", a -> a.animatable() instanceof MotorboatEntity m ? m.steer() : 0);
		MolangQueries.<Object>setActorVariable("variable.o_time", a -> (a.animatable() instanceof net.minecraft.world.entity.Entity e ? e.tickCount + a.partialTick() : 0) / 20.0);
	}
}
