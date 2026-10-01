// Builder's working graph is a view model, not an executable flow. Convert its
// content/input boundary, custom actions and outputs to the hosting state model.
// Model contract: takenet/blip-sdk-csharp/src/Take.Blip.Builder/Models.
const STATE_METADATA = {
  "#stateName": "{{state.name}}",
  "#stateId": "{{state.id}}",
  "#messageId": "{{input.message@id}}",
  "#previousStateId": "{{state.previous.id}}",
  "#previousStateName": "{{state.previous.name}}",
};

function clean(value) {
  return JSON.parse(
    JSON.stringify(value, (key, entry) => (key.startsWith("$") ? undefined : entry)),
  );
}

function actions(value = []) {
  if (!Array.isArray(value)) throw new Error("O rascunho contém uma lista de ações inválida.");
  return value.map((action) => {
    if (!action || typeof action.type !== "string" || !action.type)
      throw new Error("O rascunho contém uma ação sem tipo. Corrija o fluxo no Builder.");
    return structuredClone(action);
  });
}

function compileState(block) {
  if (!block || typeof block.id !== "string" || !block.id || !Array.isArray(block.$contentActions))
    throw new Error("O rascunho contém um bloco sem ID ou conteúdo válido.");
  const content = block.$contentActions;
  const boundary = content.findIndex((item) => item?.input != null);
  if (content.filter((item) => item?.input != null).length > 1)
    throw new Error(
      `O bloco ${block.$title || block.id} contém mais de uma entrada. Corrija-o no Builder.`,
    );
  const before = boundary < 0 ? content : content.slice(0, boundary);
  const after = boundary < 0 ? [] : content.slice(boundary + 1);
  const state = {
    id: block.id,
    root: Boolean(block.root),
    end: Boolean(block.end),
    name: block.$title,
    shortNameOfSubflow: block.shortNameOfSubflow,
    deskStateVersion: block.deskStateVersion,
    inputActions: [
      ...actions(block.$enteringCustomActions),
      ...actions(before.map((item) => item?.action)),
    ],
    ...(boundary < 0 ? {} : { input: structuredClone(content[boundary].input) }),
    outputActions: [
      ...actions(after.map((item) => item?.action)),
      ...actions(block.$leavingCustomActions),
    ],
    afterStateChangedActions: actions(block.$afterStateChangedActions),
    localCustomActions: actions(block.$localCustomActions).map((action) => ({
      ...action,
      id: action.$id,
      title: action.$title,
      description: action.$description,
    })),
    outputs: [
      ...(block.$conditionOutputs || []),
      ...(block.$defaultOutput ? [block.$defaultOutput] : []),
    ].filter((output) => !(output.$isPaymentInternalOutput && !output.stateId)),
  };
  return state;
}

function withMetadata(action) {
  if (action.type === "TrackEvent")
    action.settings = {
      ...action.settings,
      extras: { ...action.settings?.extras, ...STATE_METADATA },
    };
  if (["SendMessage", "SendRawMessage", "SendMessageFromHttp"].includes(action.type))
    action.settings = {
      ...action.settings,
      metadata: { ...action.settings?.metadata, ...STATE_METADATA },
    };
  return action;
}

function compileBuilderFlow({ flow, configuration, globalActions, flowId, previousFlow }) {
  const states = Object.values(flow).map(compileState);
  if (!states.length) throw new Error("O rascunho não contém blocos para publicar.");
  const ids = new Set(states.map((state) => state.id));
  if (ids.size !== states.length) throw new Error("O rascunho contém blocos com IDs duplicados.");
  const roots = states.filter((state) => state.root);
  if (
    roots.length !== 1 ||
    !roots[0].input ||
    roots[0].input.bypass ||
    roots[0].input.conditions?.length
  )
    throw new Error(
      "O fluxo precisa ter um único bloco inicial que espera uma entrada sem condições.",
    );
  for (const state of states) {
    for (const output of state.outputs) {
      if (
        typeof output?.stateId !== "string" ||
        (!ids.has(output.stateId) && !/^\{\{.+\}\}$/.test(output.stateId))
      )
        throw new Error(
          `O bloco ${state.name || state.id} aponta para um destino inválido. Corrija o fluxo no Builder.`,
        );
    }
    // Replicate Portal tracking without accumulating generated actions from the
    // previous runtime. Graph actions are always the source of the new state.
    state.inputActions.forEach(withMetadata);
    state.outputActions.forEach(withMetadata);
    if (String(configuration["builder:stateTrack"]).toLowerCase() === "true") {
      const metadata = state.root
        ? { "#stateName": state.name, "#stateId": state.id, "#messageId": "{{input.message@id}}" }
        : STATE_METADATA;
      const track = {
        type: "TrackEvent",
        settings: {
          category: "flow",
          action: state.name || state.id,
          extras: { stateId: state.id, ...metadata },
        },
      };
      (state.root ? state.outputActions : state.inputActions).unshift(track);
    }
    const journeyEnabled = previousFlow?.states?.some((state) =>
      [...(state.inputActions || []), ...(state.outputActions || [])].some(
        (action) => action.type === "TrackContactsJourney",
      ),
    );
    if (journeyEnabled) {
      const settings = state.root
        ? { stateId: state.id, stateName: state.name }
        : {
            previousStateId: "{{state.previous.id}}",
            previousStateName: "{{state.previous.name}}",
            stateId: "{{state.id}}",
            stateName: "{{state.name}}",
          };
      (state.root ? state.outputActions : state.inputActions).unshift({
        type: "TrackContactsJourney",
        settings,
      });
    }
  }
  const globals = compileState({ id: "global-actions", $contentActions: [], ...globalActions });
  return clean({
    id: flowId,
    version: 1,
    type: "flow",
    states,
    configuration,
    inputActions: globals.inputActions,
    outputActions: globals.outputActions,
  });
}

module.exports = { compileBuilderFlow, clean };
