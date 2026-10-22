// Item ids: recipes are written with Java ids; a few are named differently on Bedrock.
export const JAVA_TO_BEDROCK = {};

export const bedrockId = (id) => {
  const b = JAVA_TO_BEDROCK[id] ?? id;
  return b.includes(':') ? b : `minecraft:${b}`;
};
export const javaId = (id) => (id.includes(':') ? id : `minecraft:${id}`);
