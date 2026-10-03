import { expect, test } from "@playwright/test";

import { expectAccessible, login, mailLink, NEW_PASSWORD, PASSWORD, totp, uniqueEmail } from "./support";

test.describe.configure({ mode: "serial" });

/**
 * Flujo completo contra el API real: registro → verificación → login → MFA (TOTP + recuperación) →
 * sesiones (revocar las demás) → recuperar contraseña (revoca todas) → login con la nueva.
 */
test("cuenta de extremo a extremo", async ({ page, browser }) => {
  const email = uniqueEmail("flow");

  await test.step("registro con aceptación explícita de términos", async () => {
    await page.goto("/auth/register");
    await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
    await expectAccessible(page, "registro");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await expect(page.getByText(/Seguridad de la contraseña: (fuerte|muy fuerte)/)).toBeVisible();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Debes aceptar los términos")).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeFocused();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByText("Revisa tu correo")).toBeVisible();
  });

  await test.step("verificación por enlace de un solo uso (el token sale de la URL)", async () => {
    const link = await mailLink(email, "verify-email");
    await page.goto(link);
    await expect(page.getByText("Correo confirmado")).toBeVisible();
    expect(page.url()).not.toContain("token=");
    const reuse = await page.context().newPage();
    await reuse.goto(link);
    await expect(reuse.getByText("El enlace no es válido")).toBeVisible();
    await reuse.close();
  });

  let secret = "";
  await test.step("login y activación de MFA con códigos de recuperación", async () => {
    await login(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("link", { name: "Mi cuenta" })).toBeVisible();
    await expectAccessible(page, "cuenta");
    await page.getByRole("link", { name: "Seguridad" }).click();
    await page.getByRole("button", { name: "Activar verificación en dos pasos" }).click();
    await expect(page.getByRole("img", { name: /Código QR/ })).toBeVisible();
    secret = (await page.locator("code").innerText()).replace(/\s+/g, "");
    await expectAccessible(page, "seguridad-qr");
    await page.getByLabel("Código de verificación").fill(totp(secret));
    await page.getByRole("button", { name: "Confirmar y activar" }).click();
    await expect(page.getByText("Guarda tus códigos de recuperación")).toBeVisible();
    await expect(page.locator("ol li")).toHaveCount(10);
  });
  const codes = await page.locator("ol li").allInnerTexts();
  await page.getByRole("button", { name: "Ya los guardé" }).click();
  await expect(page.getByText("La verificación en dos pasos está activada.").first()).toBeVisible();

  await test.step("cerrar sesión y volver a entrar con TOTP", async () => {
    await page.goto("/account");
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/$/);
    await login(page, email, PASSWORD);
    await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
    await page.getByLabel("Código de verificación").fill(totp(secret, 1));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });

  const other = await browser.newContext({ locale: "es-DO" });
  const otherPage = await other.newPage();
  await test.step("segunda sesión con código de recuperación", async () => {
    await login(otherPage, email, PASSWORD);
    await otherPage.getByRole("button", { name: "Usar un código de recuperación" }).click();
    await otherPage.getByLabel("Código de recuperación").fill(codes[0]!.toLowerCase());
    await otherPage.getByRole("button", { name: "Verificar" }).click();
    await expect(otherPage).toHaveURL(/\/account$/);
  });

  await test.step("sesiones: cerrar todas las demás", async () => {
    await page.goto("/account/sessions");
    await expect(page.getByText("Este dispositivo")).toBeVisible();
    await expect(page.getByRole("button", { name: /Cerrar esta sesión/ })).toHaveCount(1);
    await expectAccessible(page, "sesiones");
    await page.getByRole("button", { name: "Cerrar todas las demás sesiones" }).click();
    await expect(page.getByText("Sesiones cerradas: 1.")).toBeVisible();
    await expect(page.getByText("No hay otras sesiones abiertas.")).toBeVisible();
    await otherPage.goto("/account");
    await expect(otherPage).toHaveURL(/\/auth\/login\?next=%2Faccount$/);
  });
  await other.close();

  await test.step("recuperar contraseña revoca todas las sesiones", async () => {
    const recover = await browser.newContext({ locale: "es-DO" });
    const r = await recover.newPage();
    await r.goto("/auth/forgot");
    await expectAccessible(r, "recuperar");
    await r.getByLabel("Correo electrónico").fill(email);
    await r.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(r.getByText("Revisa tu correo")).toBeVisible();
    await r.goto(await mailLink(email, "reset-password"));
    await expect(r.locator("input").and(r.getByLabel("Nueva contraseña"))).toBeVisible();
    expect(r.url()).not.toContain("token=");
    await expectAccessible(r, "nueva-contrasena");
    await r.locator("input").and(r.getByLabel("Nueva contraseña")).fill(NEW_PASSWORD);
    await r.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(r.getByText("Contraseña actualizada")).toBeVisible();
    await recover.close();

    await page.goto("/account");
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Faccount$/);
  });

  await test.step("login con la contraseña nueva; la antigua ya no sirve", async () => {
    await login(page, email, PASSWORD);
    await expect(page.locator("main [role='alert']")).toContainText("Correo o contraseña incorrectos");
    await login(page, email, NEW_PASSWORD);
    await page.getByRole("button", { name: "Usar un código de recuperación" }).click();
    await page.getByLabel("Código de recuperación").fill(codes[1]!);
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });
});
