/**
 * Chooses a language in the console's language menu, as a person does: opens it, picks the
 * language and waits until the page is in it and the list has closed.
 */
export async function chooseLanguage(page, code) {
  await page.locator('#language').click();
  await page.locator(`#language-list [data-lang="${code}"]`).click();
  await page.waitForFunction(
    (language) =>
      document.documentElement.lang === language &&
      !document.querySelector('#language-list').matches(':popover-open'),
    code,
  );
}
