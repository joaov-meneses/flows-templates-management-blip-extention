import assert from "node:assert/strict";
import test from "node:test";
import {
  filterBuilderPickerApplications,
  selectAllVisibleBuilders,
} from "../src/lib/builderPicker.ts";

const applications = [
  { shortName: "inside-a", name: "Agendamento", template: "builder", hasPermission: true },
  { shortName: "inside-b", name: "Suporte", template: "builder", hasPermission: true },
  { shortName: "outside", name: "Outro Builder", template: "builder", hasPermission: true },
  { shortName: "router", name: "Router", template: "master", hasPermission: true },
  { shortName: "blocked", name: "Sem acesso", template: "builder", hasPermission: false },
];
const routerBuilderIds = new Set(["inside-a", "inside-b", "blocked", "router", "missing"]);

test("filtro do roteador cruza os serviços com os Builders acessíveis", () => {
  const items = filterBuilderPickerApplications(applications, {
    scope: "router",
    routerBuilderIds,
  });
  assert.deepEqual(
    items.map((item) => item.shortName),
    ["inside-a", "inside-b"],
  );
});

test("todos com acesso inclui os demais Builders e continua excluindo routers e bots sem acesso", () => {
  assert.deepEqual(
    filterBuilderPickerApplications(applications, { scope: "all", routerBuilderIds: null }).map(
      (item) => item.shortName,
    ),
    ["inside-a", "inside-b", "outside"],
  );
});

test("consulta de serviços pendente ou vazia não amplia silenciosamente a seleção", () => {
  for (const ids of [null, new Set()])
    assert.deepEqual(
      filterBuilderPickerApplications(applications, { scope: "router", routerBuilderIds: ids }),
      [],
    );
});

test("busca e exclusão do Builder de origem são respeitadas nos dois filtros", () => {
  for (const scope of ["all", "router"]) {
    assert.deepEqual(
      filterBuilderPickerApplications(applications, {
        scope,
        routerBuilderIds,
        query: "  SUPORTE  ",
      }).map((item) => item.shortName),
      ["inside-b"],
    );
    assert.deepEqual(
      filterBuilderPickerApplications(applications, {
        scope,
        routerBuilderIds,
        query: "inside",
        excludedShortName: "inside-a",
      }).map((item) => item.shortName),
      ["inside-b"],
    );
  }
});

test("selecionar todos marca apenas os exibidos e preserva a seleção fora do filtro sem duplicar", () => {
  const previous = new Set(["outside", "inside-a"]);
  const visible = filterBuilderPickerApplications(applications, {
    scope: "router",
    routerBuilderIds,
    query: "Agendamento",
  });
  const selected = selectAllVisibleBuilders(previous, visible);
  assert.deepEqual([...selected], ["outside", "inside-a"]);
  assert.notEqual(previous, selected);
  assert.deepEqual(
    [
      ...selectAllVisibleBuilders(
        new Set(),
        filterBuilderPickerApplications(applications, { scope: "router", routerBuilderIds }),
      ),
    ],
    ["inside-a", "inside-b"],
  );
});
