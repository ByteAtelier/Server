import { defineConfig } from '@umijs/max';

export default defineConfig({
  hash: true,
  routes: [{ path: '/', component: './Dashboard' }],
  layout: false,
  locale: false,
  antd: {},
});
