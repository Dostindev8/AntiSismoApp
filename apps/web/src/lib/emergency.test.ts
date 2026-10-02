import { describe, expect, it } from "vitest";

import { dominicanContacts, parseContacts, primaryContact, telHref } from "./emergency";

const valid = {
  region: "DO",
  version: 1,
  contacts: [
    {
      region: "DO",
      service: "general",
      number: "911",
      verified: true,
      source_url: "https://911.gob.do/",
      source_name: "911",
      verified_at: "2026-10-01T03:55:00Z",
      version: 1,
    },
  ],
};

describe("contactos de emergencia web", () => {
  it("RD: el número principal es el 911 verificado con fuente oficial https", () => {
    const c = primaryContact(dominicanContacts);
    expect(c.number).toBe("911");
    expect(c.source_url.startsWith("https://")).toBe(true);
  });

  it("rechaza contactos sin verificar, sin https o con número inválido", () => {
    const mutate = (patch: Record<string, unknown>) => ({ ...valid, contacts: [{ ...valid.contacts[0], ...patch }] });
    expect(() => parseContacts(mutate({ verified: false }))).toThrow();
    expect(() => parseContacts(mutate({ source_url: "http://911.gob.do/" }))).toThrow();
    expect(() => parseContacts(mutate({ number: "911;rm" }))).toThrow();
    expect(() => parseContacts({ ...valid, contacts: [] })).toThrow();
  });

  it("telHref sanea y rechaza inyección", () => {
    expect(telHref("911")).toBe("tel:911");
    expect(telHref("*462#")).toBe("tel:*462%23");
    expect(() => telHref("911?body=x")).toThrow();
    expect(() => telHref("javascript:alert(1)")).toThrow();
  });
});
