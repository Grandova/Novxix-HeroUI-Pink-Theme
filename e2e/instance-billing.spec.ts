import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'test-token')
    localStorage.setItem('user', JSON.stringify({ id: 1, username: 'test', role: 'admin' }))
  })
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const data = path === '/api/v1/settings/public'
      ? { site_name: 'Hero Pink', timezone: 'Asia/Shanghai' }
      : path.endsWith('/unread-count') ? { count: 0 } : []
    return route.fulfill({ json: { code: 0, data } })
  })
})

const instance = {
  id: 1, name: 'billing-test', status: 'stopped', type: 'container',
  billing_cycle: 'monthly', expire_at: '2026-10-20T12:30:00Z',
  auto_renew: false, cpu: 2, memory: 1024, disk: 20,
  ip_address: '192.0.2.1', node_name: 'test-node',
  created_at: '2026-09-20T00:00:00Z',
}

test('自动续费开关提交正确数据并在刷新后保留状态', async ({ page }) => {
  let enabled = false
  const bodies: unknown[] = []
  await page.route('**/api/v1/portal/instances/1', route => route.fulfill({ json: { code: 0, data: { ...instance, auto_renew: enabled } } }))
  await page.route('**/api/v1/portal/instances/1/auto-renew', async route => {
    expect(route.request().method()).toBe('POST')
    const body = route.request().postDataJSON()
    bodies.push(body)
    enabled = body.enabled
    await route.fulfill({ json: { code: 0 } })
  })
  await page.goto('/portal/servers/1')
  const toggle = page.getByRole('switch', { name: '自动续费' })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await page.reload()
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  expect(bodies).toEqual([{ enabled: true }, { enabled: false }])
  await expect(page.locator('body')).toHaveAttribute('data-portal-theme', 'heroui')
})

for (const status of [200, 500]) {
  test(`自动续费失败保留原状态并允许重试 HTTP ${status}`, async ({ page }) => {
    await page.route('**/api/v1/portal/instances/1', route => route.fulfill({ json: { code: 0, data: instance } }))
    await page.route('**/api/v1/portal/instances/1/auto-renew', route => route.fulfill({ status, json: { code: 1, message: '续费设置失败' } }))
    await page.goto('/portal/servers/1')
    const toggle = page.getByRole('switch', { name: '自动续费' })
    await toggle.click()
    await expect(page.getByText('续费设置失败', { exact: true })).toBeVisible()
    await expect(toggle).not.toBeChecked()
    await expect(toggle).toBeEnabled()
  })
}

for (const mode of ['hourly', 'never']) {
  test(`${mode} 实例不显示自动续费`, async ({ page }) => {
    await page.route('**/api/v1/portal/instances/1', route => route.fulfill({ json: {
      code: 0, data: { ...instance, billing_cycle: mode === 'hourly' ? 'hourly' : 'monthly', expire_at: mode === 'never' ? null : instance.expire_at },
    } }))
    await page.goto('/portal/servers/1')
    await expect(page.getByText('计费周期', { exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: '自动续费' })).toHaveCount(0)
  })
}

test('后台到期时间按站点时区保存、取消以及设为永不过期', async ({ page }, testInfo) => {
  let expire: string | null = instance.expire_at
  const bodies: unknown[] = []
  await page.route('**/api/v1/admin/instances/1', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      bodies.push(body)
      expire = body.clear_expire ? null : body.expire_at
      await route.fulfill({ json: { code: 0 } })
    } else {
      await route.fulfill({ json: { code: 0, data: { ...instance, expire_at: expire } } })
    }
  })
  await page.goto('/admin/instances/1')
  await page.getByRole('button', { name: '修改到期时间', exact: true }).click()
  const input = page.getByLabel('到期时间', { exact: true })
  await expect(input).toHaveValue('2026-10-20T20:30')
  await input.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('admin-expiry.png') })
  await input.fill('2026-11-01T09:15')
  await page.getByRole('button', { name: '取消修改到期时间' }).click()
  expect(bodies).toEqual([])
  await page.getByRole('button', { name: '修改到期时间', exact: true }).click()
  await expect(input).toHaveValue('2026-10-20T20:30')
  await input.fill('')
  await expect(page.getByRole('button', { name: '保存到期时间' })).toBeDisabled()
  await input.fill('2026-11-01T09:15')
  await page.getByRole('button', { name: '保存到期时间' }).click()
  await expect(input).toHaveCount(0)
  expect(bodies).toEqual([{ expire_at: '2026-11-01T01:15:00.000Z' }])
  await page.reload()
  await page.getByRole('button', { name: '修改到期时间', exact: true }).click()
  await expect(input).toHaveValue('2026-11-01T09:15')
  await page.getByRole('button', { name: '永不过期', exact: true }).click()
  await expect(input).toHaveCount(0)
  expect(bodies[1]).toEqual({ clear_expire: true })
  await page.getByRole('button', { name: '修改到期时间', exact: true }).click()
  await expect(input).toHaveValue('')
  await input.fill('2026-12-01T08:00')
  await page.getByRole('button', { name: '保存到期时间' }).click()
  await expect(input).toHaveCount(0)
  expect(bodies[2]).toEqual({ expire_at: '2026-12-01T00:00:00.000Z' })
  await expect(page.locator('body')).not.toHaveAttribute('data-portal-theme')
})

test('到期时间保存失败保留输入且可重试', async ({ page }) => {
  await page.route('**/api/v1/admin/instances/1', route => route.fulfill({ json: route.request().method() === 'PUT'
    ? { code: 1, message: '到期时间保存失败' } : { code: 0, data: instance },
  }))
  await page.goto('/admin/instances/1')
  await page.getByRole('button', { name: '修改到期时间', exact: true }).click()
  await page.getByLabel('到期时间', { exact: true }).fill('2026-12-01T08:00')
  await page.getByRole('button', { name: '保存到期时间' }).click()
  await expect(page.getByText('到期时间保存失败', { exact: true })).toBeVisible()
  await expect(page.getByLabel('到期时间', { exact: true })).toHaveValue('2026-12-01T08:00')
  await expect(page.getByRole('button', { name: '保存到期时间' })).toBeEnabled()
})

test('手机宽度保留自动续费开关和原有管理按钮', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/v1/portal/instances/1', route => route.fulfill({ json: { code: 0, data: instance } }))
  await page.goto('/portal/servers/1')
  await expect(page.getByRole('switch', { name: '自动续费' })).toBeVisible()
  await expect(page.getByText('重装系统', { exact: true })).toBeVisible()
  await expect(page.getByText('重置密码', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('switch', { name: '自动续费' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('portal-auto-renew-mobile.png') })
})

for (const status of [200, 409]) {
  test(`订单金额变更时关闭支付框并刷新金额 HTTP ${status}`, async ({ page }) => {
    let amount = 1000
    let payments = 0
    await page.route('**/api/v1/portal/orders/1', route => route.fulfill({ json: {
      code: 0, data: { id: 1, order_no: 'test-order', type: 'renew', status: 'pending', amount, instance_id: 1 },
    } }))
    await page.route('**/api/v1/portal/orders/1/pay', route => {
      payments++
      amount = 2000
      return route.fulfill({ status, json: { code: 21210, message: '订单金额已变更，请确认后重新支付' } })
    })
    await page.goto('/portal/orders/1')
    await page.getByRole('button', { name: '立即支付' }).click()
    await page.getByRole('button', { name: /余额支付.*10\.00/ }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('订单金额已变更，请确认后重新支付', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '立即支付' }).click()
    await expect(page.getByRole('button', { name: /余额支付.*20\.00/ })).toBeVisible()
    expect(payments).toBe(1)
  })
}
