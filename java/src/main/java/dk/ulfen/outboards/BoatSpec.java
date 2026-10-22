package dk.ulfen.outboards;

import java.util.List;

import com.google.gson.reflect.TypeToken;

/** A motorboat (one per kind of wood), as generated into outboards/boats.json. */
public final class BoatSpec {
	public String id;
	public String wood;
	/** The vanilla boat item it is made from ("oak_boat", "bamboo_raft"). */
	public String item;
	public boolean raft;
	/** Seats in entity space (blocks): the driver first. */
	public List<double[]> seats;

	static List<BoatSpec> load() {
		return MotorSpec.Json.load("/outboards/boats.json", new TypeToken<List<BoatSpec>>() {});
	}
}
