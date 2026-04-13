import { defineConfig } from '@umijs/max';

export default defineConfig({
  hash: true,
  routes: [{ path: '/', component: './Home' }],
  layout: false,
  locale: false,
  antd: {},
});
