package dk.ulfen.outboards;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

/** A motor, as generated from src/motors.mjs into outboards/motors.json. */
public final class MotorSpec {
	public String id;
	public int hp;
	/** "combustion", "electric" or "inboard". */
	public String kind;
	public double thrust;
	public double maxSpeed;
	/** Tank units per tick at full throttle. */
	public double burn;
	public int tank;
	public boolean silent;
	/** An inboard engine: goes inside a ship's hull, never on a boat. */
	public boolean inboard;
	/** Item id -> tank units. */
	public Map<String, Integer> fuels;

	public boolean electric() {
		return "electric".equals(kind);
	}

	static List<MotorSpec> load() {
		return Json.load("/outboards/motors.json", new TypeToken<List<MotorSpec>>() {});
	}

	/** Reads the generated data files. */
	static final class Json {
		private static final Gson GSON = new Gson();

		static <T> T load(String path, TypeToken<T> type) {
			try (var in = MotorSpec.class.getResourceAsStream(path)) {
				if (in == null) throw new IllegalStateException(path + " is missing: run `npm run build` first");
				return GSON.fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), type.getType());
			} catch (java.io.IOException e) {
				throw new IllegalStateException(e);
			}
		}
	}
}
