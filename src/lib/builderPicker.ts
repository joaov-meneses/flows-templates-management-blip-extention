import type { PortalApplicationAccount } from "../types/templates.ts";

export type BuilderPickerScope = "router" | "all";

export function filterBuilderPickerApplications(
  applications: PortalApplicationAccount[],
  {
    scope,
    routerBuilderIds,
    query = "",
    excludedShortName = "",
  }: {
    scope: BuilderPickerScope;
    routerBuilderIds: Set<string> | null;
    query?: string;
    excludedShortName?: string;
  },
) {
  const search = query.trim().toLocaleLowerCase("pt-BR");
  return applications.filter(
    (application) =>
      application.hasPermission === true &&
      application.template !== "master" &&
      application.shortName !== excludedShortName &&
      (scope === "all" || routerBuilderIds?.has(application.shortName)) &&
      (!search ||
        `${application.name} ${application.shortName}`.toLocaleLowerCase("pt-BR").includes(search)),
  );
}

export function selectAllVisibleBuilders(
  current: Set<string>,
  applications: PortalApplicationAccount[],
) {
  return new Set([...current, ...applications.map((application) => application.shortName)]);
}
