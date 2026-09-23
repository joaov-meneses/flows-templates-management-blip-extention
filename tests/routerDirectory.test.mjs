import test from "node:test";
import assert from "node:assert/strict";
import {
  getAccessibleApplicationUri,
  getActiveTenantId,
  getApplicationListUri,
  matchesRouterSearch,
  readWhatsAppPhone,
} from "../src/lib/routerDirectory.ts";
import directoryService from "../server/routerDirectoryService.cjs";

test("uses the tenant from the current Portal application and rejects missing context", () => {
  assert.equal(getActiveTenantId({ response: { tenantId: "AmBeV" } }), "ambev");
  assert.equal(getAccessibleApplicationUri("ambev"), "/applications?tenantId=ambev");
  assert.equal(getApplicationListUri("ambev", "member"), "/applications?tenantId=ambev");
  assert.equal(
    getApplicationListUri("ember-ai-tecnologia-2g6x4", "admin"),
    "/tenants/ember-ai-tecnologia-2g6x4/applications",
  );
  assert.throws(() => getActiveTenantId({ shortName: "ambevrotprod1" }), /contrato atual/);
  assert.throws(() => getAccessibleApplicationUri("macro/other"), /Contrato inválido/);
});

test("number shown in the directory uses country code and active phone number", () => {
  const gateway = {
    "postmaster@wa.gw.msging.net": {
      CountryCode: "55",
      PhoneNumber: "1191 234 5678",
      PhoneNumberId: "meta-id-not-a-phone",
      IsChannelActive: "True",
    },
  };
  const expected = { phoneNumber: "5511912345678", status: "connected" };
  assert.deepEqual(readWhatsAppPhone(gateway), expected);
  assert.deepEqual(directoryService.parseWhatsAppPhone(gateway), expected);
  assert.deepEqual(
    readWhatsAppPhone({
      "postmaster@wa.gw.msging.net": {
        ...gateway["postmaster@wa.gw.msging.net"],
        IsChannelActive: "False",
      },
    }),
    { phoneNumber: null, status: "not-connected" },
  );
  const router = { name: "Ambev Router", shortName: "ambevrotprod1", tenantId: "ambev" };
  assert.equal(matchesRouterSearch(router, expected.phoneNumber, "+55 1191 234"), true);
  assert.equal(matchesRouterSearch(router, expected.phoneNumber, "1191-234"), true);
  assert.equal(matchesRouterSearch(router, expected.phoneNumber, "outro número"), false);
});

test("remote phone lookup performs only a GET command and verifies the responding bot", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sent = { ...options, command: JSON.parse(options.body) };
    return Response.json({
      id: sent.command.id,
      status: "success",
      to: "ambevrotprod1@msging.net/!server",
      resource: {
        "postmaster@wa.gw.msging.net": {
          CountryCode: "55",
          PhoneNumber: "11912345678",
          IsChannelActive: "True",
        },
      },
    });
  });
  const result = await directoryService.getRouterPhoneNumber({
    routerKey: "Key YWJjZA==",
    routerShortName: "ambevrotprod1",
  });
  assert.deepEqual(result, { phoneNumber: "5511912345678", status: "connected" });
  assert.equal(sent.command.method, "get");
  assert.equal(sent.command.uri, "/configuration/gateways");
  assert.equal(sent.command.to, "postmaster@configurations.msging.net");
  assert.equal(sent.redirect, "manual");
});

test("remote phone lookup rejects a response for another bot", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) =>
    Response.json({
      id: JSON.parse(options.body).id,
      status: "success",
      to: "another@msging.net/!server",
      resource: {},
    }),
  );
  await assert.rejects(
    directoryService.getRouterPhoneNumber({
      routerKey: "Key YWJjZA==",
      routerShortName: "ambevrotprod1",
    }),
    /outro router/,
  );
});
