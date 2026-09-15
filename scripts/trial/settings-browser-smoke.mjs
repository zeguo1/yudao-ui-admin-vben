import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chromium } from 'playwright';
// Every backend response is isolated; never forward a business API call.
const base = process.env.TRIAL_UI_URL || 'http://127.0.0.1:5198';
assert.equal(
  new URL(base).hostname,
  '127.0.0.1',
  'Only the isolated loopback dev server is allowed',
);
const out = process.env.OUT || '/tmp/mgs-settings-browser';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  headless: true,
  args: ['--no-sandbox'],
});
const evidence = [];
for (const scenario of ['admin', 'readonly', 'mobile']) {
  const ctx = await browser.newContext({
    viewport: { width: scenario === 'mobile' ? 390 : 1440, height: 1000 },
  });
  const p = await ctx.newPage();
  const logs = [];
  const unknown = [];
  let failed = false;
  let puts = 0;
  let issues = 0;
  const state = {
    revision: 0,
    activeRevision: 0,
    operatorTenantId: 121,
    demoTenantId: 1,
    source: '部署配置',
    notice:
      '保存后应用于本实例，其他实例最多约 5 秒刷新；配置检查不代表实际联调完成。',
    localReady: false,
    missing: ['MGS 对外 HTTPS 地址', '实际助手 ID、用户类型和渠道允许名单'],
    secretsConfigured: { sms: false, outbound: false, loginEncryption: false },
    keys: [],
    config: {
      revision: 0,
      enabled: false,
      connectorEnabled: false,
      smsEnabled: false,
      environment: '',
      publicBaseUrl: '',
      mgsLoginUrl: '',
      knowdoBaseUrl: '',
      ownerUserId: 110,
      durationDays: 7,
      maxApplications: 100,
      oauthClientId: '',
      outboundKeyId: '',
      outboundSecret: '',
      smsTemplateCode: 'trial-mobile-verify',
      codeTtlSeconds: 300,
      proofTtlSeconds: 600,
      resendSeconds: 60,
      maxAttempts: 5,
      maxPerMobilePerDay: 5,
      maxPerIdentityPerDay: 5,
      maxTotalPerDay: 500,
      issuer: 'knowdo-trial',
      assistantIds: [],
      audiences: ['anonymous'],
      channels: [],
    },
  };
  const allowed = [
    'crm:trial-settings:query',
    ...(scenario === 'readonly'
      ? []
      : ['crm:trial-settings:update', 'crm:trial-settings:secret']),
  ];
  p.on('pageerror', (e) => logs.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') logs.push(m.text());
  });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname !== '127.0.0.1')
      return route.fulfill(
        req.resourceType() === 'script'
          ? { status: 200, contentType: 'application/javascript', body: '' }
          : {
              status: 200,
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
            },
      );
    if (!u.pathname.startsWith('/admin-api')) return route.continue();
    let code = 0;
    let data = null;
    let msg = '';
    const path = u.pathname.slice(10);
    switch (path) {
      case '/crm/trial-settings/get': {
        if (failed) {
          code = 1_020_100_020;
          msg = '配置存储暂不可用';
        } else data = state;
        break;
      }
      case '/crm/trial-settings/keys/issue': {
        issues++;
        assert.notEqual(scenario, 'readonly');
        state.revision++;
        state.activeRevision = state.revision;
        state.config.revision = state.revision;
        state.keys.push({
          id: 'fixture-tools',
          kind: 'TOOLS',
          enabled: true,
          expiresAt: '2026-12-01T00:00:00Z',
          expired: false,
        });
        data = {
          settings: state,
          keyId: 'fixture-tools',
          kind: 'TOOLS',
          value: 'mgs_trial.fixture-tools.TEST-ONLY-NOT-A-REAL-SERVICE-TOKEN',
        };
        break;
      }
      case '/crm/trial-settings/keys/revoke': {
        state.keys[0].enabled = false;
        state.revision++;
        state.activeRevision = state.revision;
        state.config.revision = state.revision;
        data = state;
        break;
      }
      case '/crm/trial-settings/save': {
        puts++;
        assert.notEqual(scenario, 'readonly');
        const b = req.postDataJSON();
        assert.equal(b.environment, 'production-fixture');
        state.config = { ...b, outboundSecret: '' };
        state.revision++;
        state.activeRevision = state.revision;
        state.config.revision = state.revision;
        state.source = '后台配置';
        state.secretsConfigured = {
          sms: true,
          outbound: true,
          loginEncryption: true,
        };
        data = state;
        break;
      }
      case '/system/auth/get-permission-info': {
        data = {
          user: { id: 110, username: 'qiyunadmin', nickname: '栖云管理员' },
          roles: ['tenant_admin'],
          permissions: allowed,
          menus: [
            {
              id: 901,
              parentId: 0,
              name: '知办对接配置',
              path: '/knowdo-integration',
              component: 'crm/trial/settings/index',
              componentName: 'CrmTrialSettings',
              visible: true,
              keepAlive: false,
              sort: 1,
            },
          ],
        };
        break;
      }
      case '/system/auth/login': {
        data = {
          accessToken: 'isolated-fixture',
          refreshToken: 'isolated-refresh',
          userId: 110,
          expiresTime: 9_999_999_999,
        };
        break;
      }
      case '/system/dict-data/simple-list':
      case '/system/notify-message/get-unread-list': {
        data = [];
        break;
      }
      case '/system/notify-message/get-unread-count': {
        data = 0;
        break;
      }
      case '/system/tenant/get-by-website': {
        data = null;
        break;
      }
      case '/system/tenant/simple-list': {
        data = [{ id: 121, name: '栖云管理系统' }];
        break;
      }
      default: {
        unknown.push(path);
        code = 403;
        msg = '隔离测试未提供此接口';
      }
    }
    return route.fulfill({ json: { code, data, msg } });
  });
  try {
    await p.goto(`${base}/auth/login?redirect=%2Fknowdo-integration`);
    await p.getByPlaceholder('请输入用户名').fill('qiyunadmin');
    await p.getByPlaceholder('请输入密码').fill('FixtureOnly12345');
    await p.getByRole('button', { name: 'login', exact: true }).click();
    await p.getByText('配置检查', { exact: true }).waitFor({ timeout: 60_000 });
    assert.equal(new URL(p.url()).pathname, '/knowdo-integration');
    const pageTitle = await p.title();
    assert.ok(pageTitle.length > 0);
    await p.waitForTimeout(1600);
    for (const close of await p.locator('.ant-notification-notice-close').all())
      await close.click();
    await p.waitForTimeout(350);
    await p.screenshot({
      path: `${out}/${scenario}-initial.png`,
      fullPage: false,
    });
    if (scenario === 'readonly') {
      assert.equal(
        await p
          .getByRole('button', { name: '保存并应用', exact: true })
          .count(),
        0,
      );
      assert.ok(
        await p
          .locator('.ant-form-item')
          .filter({ has: p.getByText('环境标识', { exact: true }) })
          .locator('input')
          .isDisabled(),
      );
      await p.getByRole('tab', { name: '服务凭据', exact: true }).click();
      assert.equal(
        await p
          .getByRole('button', { name: '签发新凭据', exact: true })
          .count(),
        0,
      );
    } else {
      await p
        .locator('.ant-form-item')
        .filter({ has: p.getByText('环境标识', { exact: true }) })
        .locator('input')
        .fill('production-fixture');
      await p.getByRole('button', { name: '保存并应用', exact: true }).click();
      await p.getByText('后台配置 · 版本 1', { exact: true }).waitFor();
      assert.equal(puts, 1);
      if (scenario === 'mobile') {
        await p.locator('.mobile-tabs .ant-select-selector').click();
        await p.getByTitle('服务凭据', { exact: true }).click();
      } else {
        await p.getByRole('tab', { name: '服务凭据', exact: true }).click();
      }
      await p.getByRole('button', { name: '签发新凭据', exact: true }).click();
      await p
        .getByRole('button', { name: '签发并显示一次', exact: true })
        .click();
      await p.getByText('凭据仅展示本次', { exact: true }).waitFor();
      assert.equal(
        await p.getByLabel('本次签发的服务凭据').inputValue(),
        'mgs_trial.fixture-tools.TEST-ONLY-NOT-A-REAL-SERVICE-TOKEN',
      );
      await p
        .getByRole('button', { name: '已保存，关闭', exact: true })
        .click();
      await p.waitForTimeout(350);
      const pageContent = await p.locator('body').innerText();
      assert.ok(!pageContent.includes('TEST-ONLY-NOT-A-REAL-SERVICE-TOKEN'));
      assert.equal(await p.getByLabel('本次签发的服务凭据').count(), 0);
      await p.getByRole('button', { name: '撤销', exact: true }).click();
      await p.getByRole('button', { name: /确.*定/ }).click();
      await p.getByText('已撤销', { exact: true }).waitFor();
      await p.screenshot({
        path: `${out}/${scenario}-revoked.png`,
        fullPage: false,
      });
      failed = true;
      await p.getByRole('button', { name: '重新读取', exact: true }).click();
      await p.getByText('无法读取对接配置', { exact: true }).waitFor();
      assert.equal(
        await p
          .getByRole('button', { name: '签发新凭据', exact: true })
          .count(),
        0,
      );
      await p.screenshot({
        path: `${out}/${scenario}-error.png`,
        fullPage: false,
      });
    }
    const horizontal = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    assert.ok(!horizontal, 'viewport overflow');
    assert.deepEqual(unknown, []);
    assert.deepEqual(logs, []);
    evidence.push({
      scenario,
      puts,
      issues,
      consoleErrors: logs.length,
      unknownApis: unknown.length,
      url: p.url(),
      title: await p.title(),
      passed: true,
    });
  } catch (error) {
    await p.screenshot({
      path: `${out}/${scenario}-failure.png`,
      fullPage: false,
    });
    fs.writeFileSync(
      `${out}/failure.txt`,
      `${error.stack}\n${await p.locator('body').innerText()}\nlogs:${JSON.stringify(logs)}\nunknown:${JSON.stringify(unknown)}`,
    );
    throw error;
  } finally {
    await ctx.close();
  }
}
fs.writeFileSync(`${out}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
await browser.close();
