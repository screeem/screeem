import { test, expect } from '@playwright/test'

test.describe('UI Components', () => {
  test.describe('Landing Page Components', () => {
    test('should render hero section correctly', async ({ page }) => {
      await page.goto('/')

      // Check main heading
      const heading = page.locator('h1')
      await expect(heading).toHaveText('Screeem')
      await expect(heading).toHaveClass(/text-6xl/)
      await expect(heading).toHaveClass(/font-bold/)
    })

    test('should render tagline', async ({ page }) => {
      await page.goto('/')

      const tagline = page.locator('text=Social Media Scheduling Platform')
      await expect(tagline).toBeVisible()
    })

    test('should render CTA button with correct styling', async ({ page }) => {
      await page.goto('/')

      const ctaButton = page.getByRole('link', { name: 'Get Started' })
      await expect(ctaButton).toBeVisible()
      await expect(ctaButton).toHaveClass(/bg-primary/)
      await expect(ctaButton).toHaveClass(/rounded-lg/)
    })

    test('should center content on page', async ({ page }) => {
      await page.goto('/')

      const container = page.locator('.flex.min-h-screen.items-center.justify-center')
      await expect(container).toBeVisible()
    })
  })

  test.describe('Login Page Components', () => {
    test('should render form with correct structure', async ({ page }) => {
      await page.goto('/auth/login')

      // Form should exist
      const form = page.locator('form')
      await expect(form).toBeVisible()

      // Should have email input inside form
      const emailInput = form.getByPlaceholder('you@example.com')
      await expect(emailInput).toBeVisible()

      // Should have submit button inside form
      const submitButton = form.getByRole('button', { name: 'Send magic link' })
      await expect(submitButton).toBeVisible()
    })

    test('should style input correctly', async ({ page }) => {
      await page.goto('/auth/login')

      const emailInput = page.getByPlaceholder('you@example.com')
      await expect(emailInput).toHaveClass(/rounded-md/)
      await expect(emailInput).toHaveClass(/border/)
    })

    test('should style submit button correctly', async ({ page }) => {
      await page.goto('/auth/login')

      const submitButton = page.getByRole('button', { name: 'Send magic link' })
      await expect(submitButton).toHaveClass(/bg-primary/)
      await expect(submitButton).toHaveClass(/rounded-md/)
      await expect(submitButton).toHaveClass(/w-full/)
    })

    test('should have proper spacing between elements', async ({ page }) => {
      await page.goto('/auth/login')

      // Container should have spacing class
      const container = page.locator('.space-y-8')
      await expect(container).toBeVisible()
    })
  })

  test.describe('Form Interactions', () => {
    test('should focus email input on page load after tab', async ({ page }) => {
      await page.goto('/auth/login')

      await page.keyboard.press('Tab')

      const emailInput = page.getByPlaceholder('you@example.com')
      await expect(emailInput).toBeFocused()
    })

    test('should show focus ring on input when focused', async ({ page }) => {
      await page.goto('/auth/login')

      const emailInput = page.getByPlaceholder('you@example.com')
      await emailInput.focus()

      // Input should have focus styles
      await expect(emailInput).toBeFocused()
    })

    test('should allow typing in email input', async ({ page }) => {
      await page.goto('/auth/login')

      const emailInput = page.getByPlaceholder('you@example.com')
      await emailInput.fill('test@example.com')

      await expect(emailInput).toHaveValue('test@example.com')
    })

    test('should clear input value', async ({ page }) => {
      await page.goto('/auth/login')

      const emailInput = page.getByPlaceholder('you@example.com')
      await emailInput.fill('test@example.com')
      await emailInput.clear()

      await expect(emailInput).toHaveValue('')
    })

    test('should disable button while loading', async ({ page }) => {
      await page.goto('/auth/login')

      const emailInput = page.getByPlaceholder('you@example.com')
      await emailInput.fill('test@example.com')

      const submitButton = page.getByRole('button', { name: 'Send magic link' })
      await submitButton.click()

      // Button should be disabled during loading
      const loadingButton = page.getByRole('button', { name: 'Sending...' })
      await expect(loadingButton).toBeDisabled()
    })
  })

  test.describe('Visual Consistency', () => {
    test('landing page should have consistent layout', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Check that all main elements are visible and properly positioned
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Get Started' })).toBeVisible()

      // Verify page is centered
      const container = page.locator('.flex.min-h-screen.items-center.justify-center')
      await expect(container).toBeVisible()
    })

    test('login page should have consistent layout', async ({ page }) => {
      await page.goto('/auth/login')
      await page.waitForLoadState('networkidle')

      // Check that all main elements are visible
      await expect(page.locator('h2')).toBeVisible()
      await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send magic link' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Back to home' })).toBeVisible()
    })

    test('pages should not have horizontal scroll', async ({ page }) => {
      await page.goto('/')

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      const viewportWidth = await page.evaluate(() => window.innerWidth)

      // Body should not be wider than viewport (no horizontal scroll)
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth)
    })
  })
})
