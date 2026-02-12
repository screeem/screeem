import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test.describe('Public Navigation', () => {
    test('should load landing page at root URL', async ({ page }) => {
      const response = await page.goto('/')

      expect(response?.status()).toBe(200)
      await expect(page.locator('h1')).toBeVisible()
    })

    test('should load login page', async ({ page }) => {
      const response = await page.goto('/auth/login')

      expect(response?.status()).toBe(200)
      await expect(page.locator('h2')).toBeVisible()
    })

    test('should handle 404 for unknown routes gracefully', async ({ page }) => {
      await page.goto('/unknown-route-that-does-not-exist')

      // SPA should handle this - either show 404 or redirect to home
      // Just check the page loads without crashing
      await expect(page.locator('body')).toBeVisible()
    })
  })

  test.describe('Page Titles and Meta', () => {
    test('landing page should have proper title', async ({ page }) => {
      await page.goto('/')

      // Title should contain app name
      await expect(page).toHaveTitle(/Screeem/i)
    })
  })

  test.describe('Responsive Design', () => {
    test('landing page should be responsive on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 }) // iPhone SE
      await page.goto('/')

      await expect(page.locator('h1')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Get Started' })).toBeVisible()
    })

    test('login page should be responsive on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/auth/login')

      await expect(page.locator('h2')).toBeVisible()
      await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible()
    })

    test('landing page should work on tablet', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 }) // iPad
      await page.goto('/')

      await expect(page.locator('h1')).toBeVisible()
    })

    test('landing page should work on desktop', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.goto('/')

      await expect(page.locator('h1')).toBeVisible()
    })
  })

  test.describe('Accessibility', () => {
    test('landing page should have main heading', async ({ page }) => {
      await page.goto('/')

      // Should have exactly one h1
      const h1Count = await page.locator('h1').count()
      expect(h1Count).toBe(1)
    })

    test('login form should have proper labels', async ({ page }) => {
      await page.goto('/auth/login')

      // Email input should have a label
      const emailLabel = page.locator('label[for="email"]')
      await expect(emailLabel).toBeVisible()
      await expect(emailLabel).toHaveText(/email/i)
    })

    test('interactive elements should be keyboard accessible', async ({ page }) => {
      await page.goto('/auth/login')

      // Tab to email input
      await page.keyboard.press('Tab')

      // Email input should be focused
      const emailInput = page.getByPlaceholder('you@example.com')
      await expect(emailInput).toBeFocused()

      // Tab to submit button
      await page.keyboard.press('Tab')
      const submitButton = page.getByRole('button', { name: 'Send magic link' })
      await expect(submitButton).toBeFocused()
    })
  })

  test.describe('Performance', () => {
    test('landing page should load quickly', async ({ page }) => {
      const startTime = Date.now()
      await page.goto('/')
      await page.locator('h1').waitFor()
      const loadTime = Date.now() - startTime

      // Should load in under 5 seconds
      expect(loadTime).toBeLessThan(5000)
    })

    test('login page should load quickly', async ({ page }) => {
      const startTime = Date.now()
      await page.goto('/auth/login')
      await page.locator('h2').waitFor()
      const loadTime = Date.now() - startTime

      // Should load in under 5 seconds
      expect(loadTime).toBeLessThan(5000)
    })
  })
})
