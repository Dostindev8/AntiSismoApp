import { expect, test } from "@playwright/test";

import { expectAccessible, login, mailLink, PASSWORD, uniqueEmail } from "./support";

test.describe("abuso y casos límite de autenticación", () => {
  test("anti-enumeración: mismo mensaje para cuenta inexistente y contraseña incorrecta", async ({ page }) => {
    await login(page, uniqueEmail("nobody"), "contraseña-incorrecta-123");
    const unknown = await page.locator("main [role='alert']").innerText();
    const email = uniqueEmail("enum");
    await page.goto("/auth/register");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.goto(await mailLink(email, "verify-email"));
    await expect(page.getByText("Correo confirmado")).toBeVisible();
    await login(page, email, "contraseña-incorrecta-123");
    await expect(page.locator("main [role='alert']")).toHaveText(unknown);
  });

  test("anti-enumeración: registrar un correo existente responde igual", async ({ page }) => {
    const email = uniqueEmail("dup");
    for (let i = 0; i < 2; i++) {
      await page.goto("/auth/register");
      await page.getByLabel("Correo electrónico").fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await expect(page.getByText(`Si la dirección ${email} puede registrarse`)).toBeVisible();
    }
  });

  for (const next of ["https://evil.example/robar", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
    test(`redirección abierta bloqueada: next=${next}`, async ({ page }) => {
      const email = uniqueEmail("redir");
      await page.goto("/auth/register");
      await page.getByLabel("Correo electrónico").fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await page.goto(await mailLink(email, "verify-email"));
      await expect(page.getByText("Correo confirmado")).toBeVisible();
      await page.goto(`/auth/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel("Correo electrónico").fill(email);
      await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/account$/);
    });
  }

  test("guarda: /account sin sesión lleva a login con next interno", async ({ page }) => {
    await page.goto("/account/sessions");
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Faccount%2Fsessions$/);
  });

  test("validación accesible: el foco va al primer campo inválido", async ({ page }) => {
    await page.goto("/auth/login");
    await expectAccessible(page, "login");
    await page.getByRole("button", { name: "Entrar" }).click();
    const email = page.getByLabel("Correo electrónico");
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAccessibleDescription("Este campo es obligatorio.");
    await email.fill("no-es-correo");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(email).toHaveAccessibleDescription(/Escribe un correo válido/);
  });

  test("enlaces inválidos o incompletos muestran un estado claro", async ({ page }) => {
    await page.goto("/auth/verify#token=" + "x".repeat(10));
    await expect(page.getByText("El enlace no es válido")).toBeVisible();
    await expectAccessible(page, "verificar-invalido");
    await page.goto("/auth/verify#token=" + "A".repeat(43));
    await expect(page.getByText("El enlace no es válido")).toBeVisible();
    await page.goto("/auth/reset");
    await expect(page.getByText("Este enlace está incompleto")).toBeVisible();
    await expectAccessible(page, "restablecer-incompleto");
  });

  test("sin conexión: aviso visible y envío deshabilitado sin perder lo escrito", async ({ page, context }) => {
    await page.goto("/auth/forgot");
    await page.getByLabel("Correo electrónico").fill("ana@example.com");
    await context.setOffline(true);
    await expect(page.getByText(/Sin conexión/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar enlace" })).toBeDisabled();
    await expect(page.getByLabel("Correo electrónico")).toHaveValue("ana@example.com");
    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Enviar enlace" })).toBeEnabled();
  });

  test("las pantallas de cuenta no se indexan", async ({ page }) => {
    for (const path of ["/auth/login", "/auth/register", "/auth/reset"]) {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
  });
});
