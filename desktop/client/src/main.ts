/**
 * ============================================================================
 * 文件：main.ts — Vue 应用入口文件
 * ============================================================================
 *
 * 【插件注册顺序】
 *   1. Pinia — 状态管理（当前项目未实际使用 store，但已预装）
 *   2. Router — 路由（createWebHistory 模式，依赖 Vite devServer 代理 /api → 后端）
 *   3. Element Plus — UI 组件库，配置中文语言包 zhCn
 *   4. Element Plus Icons — 全量注册所有图标组件（方便模板中直接使用 <el-icon> + 组件名）
 *
 * 【代理配置】
 *   前端开发服务器的 /api 请求会被 Vite 配置的 proxy 转发到后端 Express 服务（默认 3001 端口），
 *   生产环境则需要通过 nginx 反向代理或后端直接提供静态文件服务。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
}

app.mount('#app')
