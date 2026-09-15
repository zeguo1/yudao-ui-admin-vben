<script setup lang="ts">
import type {
  IssuedKey,
  KeyKind,
  ServiceKey,
  SettingsInput,
  SettingsView,
} from '#/api/crm/trial/settings';

import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
} from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Input,
  InputNumber,
  InputPassword,
  message,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue';

import {
  getSettings,
  issueKey,
  revokeKey,
  saveSettings,
} from '#/api/crm/trial/settings';

const { hasAccessByCodes } = useAccess();
const canUpdate = computed(() =>
  hasAccessByCodes(['crm:trial-settings:update']),
);
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
const state = ref<SettingsView>();
const draft = ref<SettingsInput>();
const loading = ref(false);
const busy = ref(false);
const failed = ref(false);
const error = ref('');
const issued = ref<IssuedKey>();
const keyDialog = ref(false);
const keyKind = ref<KeyKind>('TOOLS');
const keyDays = ref(90);
const tab = ref('general');
const tabOptions = [
  { value: 'general', label: '基础与开户' },
  { value: 'context', label: '调用允许名单' },
  { value: 'sms', label: '短信验证' },
  { value: 'callback', label: '知办回调' },
  { value: 'keys', label: '服务凭据' },
  { value: 'handoff', label: '知办填写项' },
];
let sequence = 0;
let active = true;
const baseline = ref('');
const dirty = computed(
  () => !!draft.value && JSON.stringify(draft.value) !== baseline.value,
);
const kindNames: Record<KeyKind, string> = {
  TOOLS: 'Agent 工具 Token',
  CARD: '安全卡片 Token',
  PRIVATE_HMAC: '知办私有服务 HMAC',
};
const keyOptions = Object.entries(kindNames).map(([value, label]) => ({
  value,
  label,
}));
const audienceOptions = [
  { value: 'anonymous', label: '匿名访客（anonymous）' },
  { value: 'customer', label: '客户（customer）' },
  { value: 'employee', label: '员工（employee）' },
];
const columns = [
  { title: '凭据编号', dataIndex: 'id', width: 260 },
  { title: '用途', key: 'kind' },
  { title: '有效期（UTC）', dataIndex: 'expiresAt' },
  { title: '状态', key: 'state' },
  { title: '操作', key: 'actions' },
];
const apiUrl = computed(() =>
  (state.value?.config.publicBaseUrl || '').replace(/\/$/, ''),
);
function accept(value: SettingsView) {
  state.value = value;
  draft.value = clone(value.config);
  draft.value.outboundSecret = '';
  baseline.value = JSON.stringify(draft.value);
}
async function load() {
  const request = ++sequence;
  loading.value = true;
  failed.value = false;
  error.value = '';
  try {
    const value = await getSettings();
    if (active && request === sequence) accept(value);
  } catch {
    if (active && request === sequence) {
      failed.value = true;
      state.value = undefined;
      draft.value = undefined;
    }
  } finally {
    if (request === sequence) loading.value = false;
  }
}
function refresh() {
  if (dirty.value)
    Modal.confirm({ title: '放弃尚未保存的修改并重新读取？', onOk: load });
  else void load();
}
async function save() {
  if (!draft.value || busy.value) return;
  const request = sequence;
  busy.value = true;
  error.value = '';
  try {
    const value = await saveSettings(clone(draft.value));
    if (active && request === sequence) {
      accept(value);
      message.success('配置已保存并应用于当前服务');
    }
  } catch {
    if (active && request === sequence)
      error.value =
        '未能确认配置已保存。请核对上方接口提示；如提示版本冲突，请重新读取后再修改。';
  } finally {
    busy.value = false;
    if (draft.value) draft.value.outboundSecret = '';
  }
}
async function createKey() {
  if (!state.value || busy.value || dirty.value) return;
  const request = sequence;
  busy.value = true;
  error.value = '';
  try {
    const result = await issueKey(
      state.value.revision,
      keyKind.value,
      keyDays.value,
    );
    if (active && request === sequence) {
      accept(result.settings);
      keyDialog.value = false;
      issued.value = result;
    }
  } catch {
    if (active && request === sequence)
      error.value =
        '签发结果未确认，请先重新读取凭据列表。若已生成但未收到明文，请撤销该条后重新签发。';
  } finally {
    busy.value = false;
  }
}
function revoke(key: ServiceKey) {
  Modal.confirm({
    title: `撤销 ${key.id}？`,
    content:
      '使用此凭据的调用将被拒绝。轮换时请先配置并验证新凭据，再撤销旧凭据。',
    async onOk() {
      if (!state.value) return;
      const request = sequence;
      busy.value = true;
      try {
        const result = await revokeKey(state.value.revision, key.id, key.kind);
        if (active && request === sequence) {
          accept(result);
          message.success('凭据已撤销');
        }
      } catch {
        if (active && request === sequence)
          error.value = '撤销结果未确认，请重新读取凭据状态。';
      } finally {
        busy.value = false;
      }
    },
  });
}
async function copyValue(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    message.success('已复制，请仅粘贴到对应服务的凭据配置');
  } catch {
    message.warning('浏览器不支持自动复制，请在文本框中手动复制');
  }
}
function clearSensitive() {
  active = false;
  sequence++;
  issued.value = undefined;
  keyDialog.value = false;
  if (draft.value) draft.value.outboundSecret = '';
}
onMounted(load);
onActivated(() => {
  active = true;
});
onDeactivated(clearSensitive);
onUnmounted(clearSensitive);
</script>

<template>
  <Page
    title="知办对接配置"
    description="维护开户服务参数、调用允许名单与服务凭据"
  >
    <div class="settings-wrap">
      <div class="toolbar">
        <Space wrap>
          <Tag v-if="state">{{ state.source }} · 版本 {{ state.revision }}</Tag>
          <Tag
            v-if="state"
            :color="
              state.revision === state.activeRevision ? 'green' : 'orange'
            "
          >
            {{
              state.revision === state.activeRevision
                ? '当前服务已加载'
                : '等待服务加载'
            }}
          </Tag>
          <Tag v-if="dirty" color="orange">有未保存修改</Tag>
        </Space>
        <Space>
          <Button :loading="loading" :disabled="busy" @click="refresh">
            重新读取
          </Button>
          <Button
            v-access:code="['crm:trial-settings:update']"
            type="primary"
            :loading="busy"
            :disabled="!draft || loading"
            @click="save"
          >
            保存并应用
          </Button>
        </Space>
      </div>
      <Alert
        v-if="failed"
        type="error"
        show-icon
        message="无法读取对接配置"
        description="请确认当前为运营租户、账号具有配置权限，且后端配置表已初始化。修复后点击重新读取。"
      />
      <Alert
        v-if="error"
        class="mb-4"
        type="error"
        show-icon
        :message="error"
      />
      <Spin :spinning="loading">
        <template v-if="state && draft">
          <Alert class="mb-4" type="info" show-icon :message="state.notice" />
          <Card title="配置检查" class="mb-4">
            <Tag :color="state.localReady ? 'green' : 'orange'">
              {{
                state.localReady
                  ? '本地参数检查通过'
                  : `还有 ${state.missing.length} 项需要配置`
              }}
            </Tag>
            <ul v-if="state.missing.length" class="missing-list">
              <li v-for="item in state.missing" :key="item">{{ item }}</li>
            </ul>
            <p class="hint">
              检查只读取配置和资料，不发送短信、不创建账号，也不请求知办回调。启用前请完成安全卡片及双系统联调。
            </p>
          </Card>
          <Select
            v-model:value="tab"
            class="mobile-tabs"
            aria-label="选择配置分类"
            :options="tabOptions"
          />
          <Tabs v-model:active-key="tab" class="settings-tabs">
            <TabPane key="general" tab="基础与开户">
              <Card>
                <Form layout="vertical" :disabled="!canUpdate || busy">
                  <div class="form-grid">
                    <FormItem label="运营租户">
                      <Input
                        :value="String(state.operatorTenantId)"
                        disabled
                      /><span class="hint">服务器确定的配置管理边界。</span>
                    </FormItem>
                    <FormItem label="演示租户">
                      <Input :value="String(state.demoTenantId)" disabled />
                    </FormItem>
                    <FormItem label="环境标识">
                      <Input
                        v-model:value="draft.environment"
                        :maxlength="64"
                        placeholder="例如 production"
                      />
                    </FormItem>
                    <FormItem label="线索负责人编号">
                      <InputNumber
                        v-model:value="draft.ownerUserId"
                        :min="1"
                        class="full-width"
                      /><span class="hint">填写运营租户内已启用用户的真实编号。</span>
                    </FormItem>
                    <FormItem label="试用期限（天）">
                      <InputNumber
                        v-model:value="draft.durationDays"
                        :min="1"
                        :max="90"
                        class="full-width"
                      />
                    </FormItem>
                    <FormItem label="体验容量（申请上限）">
                      <InputNumber
                        v-model:value="draft.maxApplications"
                        :min="1"
                        :max="100000"
                        class="full-width"
                      />
                    </FormItem>
                    <FormItem label="MGS 对外 HTTPS 地址">
                      <Input
                        v-model:value="draft.publicBaseUrl"
                        placeholder="https://mgs.example.com"
                        :maxlength="512"
                      /><span class="hint">只填域名和端口。填写地址不会自动配置证书、代理或网络。</span>
                    </FormItem>
                    <FormItem label="MGS 登录 HTTPS 地址">
                      <Input
                        v-model:value="draft.mgsLoginUrl"
                        placeholder="https://mgs.example.com"
                        :maxlength="512"
                      />
                    </FormItem>
                    <FormItem label="OAuth 客户端编号">
                      <Input
                        v-model:value="draft.oauthClientId"
                        :maxlength="64"
                      /><span class="hint">对应“系统管理 → OAuth 2.0 →
                        客户端”中的客户端编号。</span>
                    </FormItem>
                    <FormItem label="开启新试用开户">
                      <Switch v-model:checked="draft.enabled" /><span
                        class="hint block"
                        >缺少必要配置时不能启用；关闭不删除已创建的申请。</span>
                    </FormItem>
                  </div>
                </Form>
              </Card>
            </TabPane>
            <TabPane key="context" tab="调用允许名单">
              <Card>
                <Form layout="vertical" :disabled="!canUpdate || busy">
                  <FormItem label="身份签发方（issuer）">
                    <Input
                      v-model:value="draft.issuer"
                      :disabled="state.keys.length > 0"
                      :maxlength="64"
                    /><span class="hint">工具、安全卡片和私有服务使用同一个值，签发凭据后保持不变。</span>
                  </FormItem>
                  <FormItem label="允许调用的助手 ID">
                    <Select
                      v-model:value="draft.assistantIds"
                      mode="tags"
                      :token-separators="[',']"
                      placeholder="填写知办中的实际助手 ID，回车添加"
                    />
                  </FormItem>
                  <FormItem label="允许的用户类型">
                    <Select
                      v-model:value="draft.audiences"
                      mode="multiple"
                      :options="audienceOptions"
                    />
                  </FormItem>
                  <FormItem label="允许的渠道标识">
                    <Select
                      v-model:value="draft.channels"
                      mode="tags"
                      :token-separators="[',']"
                      placeholder="填写知办实际传递的 channel，回车添加"
                    />
                  </FormItem>
                  <FormItem label="开启标准连接器入口">
                    <Switch v-model:checked="draft.connectorEnabled" />
                  </FormItem>
                  <p class="hint">
                    允许名单以知办后台生成的调用身份为准。不要在固定请求头或工具参数中填写身份、验证码或用户确认。
                  </p>
                </Form>
              </Card>
            </TabPane>
            <TabPane key="sms" tab="短信验证">
              <Card>
                <Form layout="vertical" :disabled="!canUpdate || busy">
                  <div class="form-grid">
                    <FormItem label="开启手机号验证">
                      <Switch v-model:checked="draft.smsEnabled" />
                    </FormItem>
                    <FormItem label="短信模板编码">
                      <Input
                        v-model:value="draft.smsTemplateCode"
                        placeholder="trial-mobile-verify"
                        :maxlength="64"
                      /><span class="hint">渠道及供应商模板在“消息中心 → 短信管理”维护。</span>
                    </FormItem>
                    <FormItem label="验证码有效期（秒）">
                      <InputNumber
                        v-model:value="draft.codeTtlSeconds"
                        :min="60"
                        :max="600"
                      />
                    </FormItem>
                    <FormItem label="验证结果有效期（秒）">
                      <InputNumber
                        v-model:value="draft.proofTtlSeconds"
                        :min="60"
                        :max="1800"
                      />
                    </FormItem>
                    <FormItem label="再次发送间隔（秒）">
                      <InputNumber
                        v-model:value="draft.resendSeconds"
                        :min="60"
                        :max="3600"
                      />
                    </FormItem>
                    <FormItem label="最多验证次数">
                      <InputNumber
                        v-model:value="draft.maxAttempts"
                        :min="1"
                        :max="5"
                      />
                    </FormItem>
                    <FormItem label="每个手机号每日上限">
                      <InputNumber
                        v-model:value="draft.maxPerMobilePerDay"
                        :min="1"
                        :max="20"
                      />
                    </FormItem>
                    <FormItem label="每个访客每日上限">
                      <InputNumber
                        v-model:value="draft.maxPerIdentityPerDay"
                        :min="1"
                        :max="20"
                      />
                    </FormItem>
                    <FormItem label="每日发送总上限">
                      <InputNumber
                        v-model:value="draft.maxTotalPerDay"
                        :min="1"
                        :max="100000"
                      />
                    </FormItem>
                    <FormItem label="验证码保护密钥">
                      <Tag
                        :color="
                          state.secretsConfigured.sms ? 'green' : 'orange'
                        "
                      >
                        {{
                          state.secretsConfigured.sms
                            ? '已配置，不回显'
                            : '首次保存时自动生成'
                        }}
                      </Tag>
                    </FormItem>
                  </div>
                </Form>
              </Card>
            </TabPane>
            <TabPane key="callback" tab="知办回调">
              <Card>
                <Alert
                  class="mb-4"
                  type="info"
                  show-icon
                  message="这里维护 MGS 调用知办的签名配置，需与知办服务端一致。保存不会验证远端接口是否已实现。"
                />
                <Form layout="vertical" :disabled="!canUpdate || busy">
                  <FormItem label="知办回调 HTTPS 基础地址">
                    <Input
                      v-model:value="draft.knowdoBaseUrl"
                      :maxlength="512"
                    /><span class="hint">当前协议会在该地址后追加 /internal/mgs-trials/v1/lookup
                      和 /ensure。</span>
                  </FormItem>
                  <FormItem label="出站签名密钥编号">
                    <Input
                      v-model:value="draft.outboundKeyId"
                      :maxlength="64"
                    />
                  </FormItem>
                  <FormItem label="出站签名密钥">
                    <InputPassword
                      v-model:value="draft.outboundSecret"
                      autocomplete="new-password"
                      :visibility-toggle="false"
                      :maxlength="512"
                      :placeholder="
                        state.secretsConfigured.outbound
                          ? '已配置；留空保留，填写则替换'
                          : '填写至少 32 个字符的服务签名密钥'
                      "
                    /><span class="hint">密钥不回显，保存后清空输入。仍有未结束申请时不允许直接替换密钥。</span>
                  </FormItem>
                  <FormItem label="账号凭据加密密钥">
                    <Tag
                      :color="
                        state.secretsConfigured.loginEncryption
                          ? 'green'
                          : 'orange'
                      "
                    >
                      {{
                        state.secretsConfigured.loginEncryption
                          ? '已配置，不回显'
                          : '首次保存时自动生成'
                      }}
                    </Tag>
                    <p class="hint">
                      由服务器管理，保留历史密钥以读取已发放账号的凭据。
                    </p>
                  </FormItem>
                </Form>
              </Card>
            </TabPane>
            <TabPane key="keys" tab="服务凭据">
              <Card>
                <Alert
                  class="mb-4"
                  type="info"
                  show-icon
                  message="服务凭据与 qiyunadmin 登录 Token 分开。新凭据只展示一次，关闭后无法再次读取。"
                />
                <Button
                  v-access:code="['crm:trial-settings:secret']"
                  class="mb-4"
                  type="primary"
                  :disabled="dirty || busy"
                  @click="keyDialog = true"
                >
                  签发新凭据
                </Button>
                <p v-if="dirty" class="hint">
                  请先保存当前参数，再签发或撤销凭据。
                </p>
                <Table
                  :columns="columns"
                  :data-source="state.keys"
                  row-key="id"
                  :pagination="false"
                  :scroll="{ x: 800 }"
                >
                  <template #bodyCell="{ column, record }">
                    <span v-if="column.key === 'kind'">{{
                      kindNames[record.kind as KeyKind]
                    }}</span>
                    <Tag
                      v-if="column.key === 'state'"
                      :color="
                        !record.enabled || record.expired ? 'default' : 'green'
                      "
                    >
                      {{
                        !record.enabled
                          ? '已撤销'
                          : record.expired
                            ? '已过期'
                            : '有效'
                      }}
                    </Tag>
                    <Button
                      v-if="column.key === 'actions' && record.enabled"
                      v-access:code="['crm:trial-settings:secret']"
                      type="link"
                      danger
                      :disabled="dirty || busy"
                      @click="revoke(record as ServiceKey)"
                    >
                      撤销
                    </Button>
                  </template>
                </Table>
              </Card>
            </TabPane>
            <TabPane key="handoff" tab="知办填写项">
              <Card>
                <Descriptions
                  :column="1"
                  bordered
                  :content-style="{ overflowWrap: 'anywhere' }"
                >
                  <DescriptionsItem label="API 基础地址">
                    {{ apiUrl || '先保存 MGS 对外 HTTPS 地址' }}
                  </DescriptionsItem>
                  <DescriptionsItem label="OpenAPI 文档">
                    {{
                      apiUrl
                        ? `${apiUrl}/v3/api-docs/trial-connector`
                        : '先保存 MGS 对外 HTTPS 地址'
                    }}
                  </DescriptionsItem>
                  <DescriptionsItem label="认证方式">
                    Bearer Token · 连接器服务账号
                  </DescriptionsItem>
                  <DescriptionsItem label="业务凭据">
                    使用 Agent 工具 Token 的完整文本，不加 Bearer 前缀。
                  </DescriptionsItem>
                  <DescriptionsItem label="可信调用身份 / 公开助手调用">
                    开启；只发布登记、开户、状态、指南 4 个工具。
                  </DescriptionsItem>
                  <DescriptionsItem label="固定请求头">
                    留空，不填写 tenant-id 或 X-KnowDo-Context。
                  </DescriptionsItem>
                  <DescriptionsItem label="安全卡片">
                    由知办后端使用安全卡片 Token 调用短信发送、校验及确认接口。
                  </DescriptionsItem>
                  <DescriptionsItem label="业务成功条件">
                    code 等于数字 0 表示本次处理成功；两侧账号就绪还需
                    data.accountReady 等于 true。
                  </DescriptionsItem>
                </Descriptions>
              </Card>
            </TabPane>
          </Tabs>
        </template>
      </Spin>
    </div>
    <Modal
      v-model:open="keyDialog"
      title="签发服务凭据"
      :confirm-loading="busy"
      ok-text="签发并显示一次"
      @ok="createKey"
    >
      <Form layout="vertical" :disabled="busy">
        <FormItem label="凭据用途">
          <Select v-model:value="keyKind" :options="keyOptions" />
        </FormItem>
        <FormItem label="有效天数">
          <InputNumber v-model:value="keyDays" :min="1" :max="365" />
        </FormItem>
      </Form>
      <p class="hint">
        工具 Token 只能放入连接器；安全卡片和 HMAC
        凭据仅交给知办后端。签发不会自动开启接口。
      </p>
    </Modal>
    <Modal
      :open="!!issued"
      title="凭据仅展示本次"
      :footer="null"
      :mask-closable="false"
      :keyboard="false"
      @cancel="issued = undefined"
    >
      <template v-if="issued">
        <Alert
          type="warning"
          show-icon
          message="请保存到对应服务的凭据配置中。关闭后无法再次读取；遗失时请撤销并重新签发。"
          class="mb-4"
        />
        <p>{{ kindNames[issued.kind] }} · {{ issued.keyId }}</p>
        <Input.TextArea
          :value="issued.value"
          readonly
          :auto-size="{ minRows: 3, maxRows: 5 }"
          aria-label="本次签发的服务凭据"
        />
        <Space class="mt-4">
          <Button @click="copyValue(issued.value)">复制凭据</Button><Button type="primary" @click="issued = undefined">
            已保存，关闭
          </Button>
        </Space>
      </template>
    </Modal>
  </Page>
</template>

<style scoped>
.settings-wrap {
  max-width: 1200px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ant-color-text-secondary, #777);
}

.block {
  display: block;
}

.full-width {
  width: 100%;
}

.missing-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 24px;
  padding-left: 20px;
  margin-top: 12px;
}

.mobile-tabs {
  display: none;
}

@media (max-width: 640px) {
  .form-grid,
  .missing-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .mobile-tabs {
    display: block;
    width: 100%;
    margin-bottom: 16px;
  }

  .settings-tabs :deep(.ant-tabs-nav) {
    display: none;
  }
}
</style>
