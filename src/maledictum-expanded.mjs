Hooks.once("init", () => {
  foundry.utils.mergeObject(game.impmal.config.npcRoles, {
    master: "IMPMAL_EXP.Master",
    overseer: "IMPMAL_EXP.Overseer",
  });
});
