<template>
	<div class="etf-config">
		<el-card shadow="hover">
			<template #header>
				<div style="display: flex; align-items: center; gap: 16px">
					<div>
						<el-button @click="showAddDialog" type="primary" :icon="Plus">添加ETF</el-button>
						<el-button @click="syncPrices" :icon="Refresh" :loading="syncing">同步行情</el-button>
						<el-button @click="showSyncHistoryDialog" :icon="DataBoard" :loading="syncingHistory">同步历史数据</el-button>
					</div>
				</div>
			</template>

			<el-table :data="etfList" stripe border>
				<el-table-column prop="code" label="代码" width="110" align="center" />
				<el-table-column prop="name" label="名称" min-width="130" align="left" />
				<el-table-column label="资产类型" width="110" align="center">
					<template #default="{ row }">
						<el-tag :type="assetTypeTag(row.asset_type)">{{ row.asset_type }}</el-tag>
					</template>
				</el-table-column>
				<el-table-column label="当前价格" width="120" align="center">
					<template #default="{ row }">{{ row.current_price != null && row.current_price !== '' ? Number(row.current_price).toFixed(4) : '-' }}</template>
				</el-table-column>
				<el-table-column label="涨跌幅" width="100" align="center">
					<template #default="{ row }">
						<span
							:style="{
								color: Number(row.change_pct) >= 0 ? '#f56c6c' : '#67c23a',
							}"
						>
							{{ row.change_pct != null && row.change_pct !== '' ? (Number(row.change_pct) >= 0 ? '+' : '') + Number(row.change_pct).toFixed(2) + '%' : '-' }}
						</span>
					</template>
				</el-table-column>
				<el-table-column label="历史数据开始" width="120" align="center">
					<template #default="{ row }">{{ formatDate(row.history_start) }}</template>
				</el-table-column>
				<el-table-column label="历史数据结束" width="120" align="center">
					<template #default="{ row }">{{ formatDate(row.history_end) }}</template>
				</el-table-column>
				<el-table-column label="更新时间" width="170" align="center">
					<template #default="{ row }">{{ formatDateTime(row.update_time) }}</template>
				</el-table-column>
				<el-table-column label="操作" width="240" align="center" fixed="right">
					<template #default="{ row }">
						<el-button @click="showEditDialog(row)">编辑</el-button>
						<el-button @click="goToHistory(row)">历史</el-button>
						<el-button type="danger" @click="handleDelete(row)">删除</el-button>
					</template>
				</el-table-column>
				<template #empty>
					<el-empty description="暂无ETF数据，请点击添加ETF开始配置" />
				</template>
			</el-table>
		</el-card>

		<!-- 初始比例配置卡片 -->
		<el-card shadow="hover" style="margin-top: 12px">
			<template #header>
				<div style="display: flex; justify-content: space-between; align-items: center">
					<span>初始比例配置</span>
					<div>
						<span style="margin-right: 12px; font-size: 14px">
							总占比：
							<span
								:style="{
									color: totalRatioSum <= 100 ? '#67c23a' : '#f56c6c',
									fontWeight: 'bold',
								}"
							>
								{{ totalRatioSum.toFixed(2) }}%
							</span>
						</span>
						<el-button type="primary" @click="saveRatios" :loading="savingRatios" :disabled="totalRatioSum > 100">保存比例</el-button>
					</div>
				</div>
			</template>
			<el-alert v-if="totalRatioSum > 100" :title="`当前总占比为${totalRatioSum.toFixed(2)}%，请调整至100%以内`" type="error" show-icon style="margin-bottom: 12px" closable />
			<el-table :data="ratioList" stripe>
				<el-table-column prop="etf_code" label="代码" width="100" align="center" />
				<el-table-column prop="name" label="名称" min-width="110" align="left" />
				<el-table-column prop="asset_type" label="类型" width="90" align="center" />
				<el-table-column label="启用" width="90" align="center">
					<template #default="{ row }">
						<el-switch v-model="row.isEnabled" @change="(val) => { if (!val) row.ratio = 0 }" />
					</template>
				</el-table-column>
				<el-table-column label="初始占比(%)" width="170" align="center">
					<template #default="{ row }">
						<el-input-number v-model="row.ratio" :min="0" :max="100" :precision="2" :step="1" :controls="true" :disabled="!row.isEnabled" style="width: 130px" />
					</template>
				</el-table-column>
				<el-table-column label="每档加减比/步长(%)" width="180" align="center">
					<template #default="{ row }">
						<el-input-number v-model="row.stepRatio" :min="0.1" :max="50" :precision="2" :step="0.5" :controls="true" :disabled="!row.isEnabled" style="width: 140px" />
					</template>
				</el-table-column>
				<el-table-column label="操作" width="100" align="center">
					<template #default="{ row }">
						<el-button :disabled="totalRatioSum >= 100 || !row.isEnabled" @click="setMax(row)" size="small">补满</el-button>
					</template>
				</el-table-column>
			</el-table>
			<div v-if="ratioList.length === 0" style="text-align: center; padding: 30px; color: #909399">暂无ETF数据，请先在\"ETF管理\"中添加ETF</div>
		</el-card>

		<el-dialog v-model="addDialogVisible" :title="isEditing ? '编辑ETF' : '添加ETF'" width="500px">
			<el-form :model="etfForm" label-width="90px" :rules="rules" ref="formRef">
				<el-form-item label="ETF代码" prop="code">
					<el-input v-model="etfForm.code" placeholder="如: 510300" :disabled="isEditing" />
				</el-form-item>
				<el-form-item label="ETF名称" prop="name">
					<el-input v-model="etfForm.name" placeholder="如: 沪深300ETF" />
				</el-form-item>
				<el-form-item label="资产类型" prop="assetType">
					<el-select v-model="etfForm.assetType" placeholder="选择资产类型" style="width: 100%">
						<el-option v-for="t in assetTypes" :key="t" :label="t" :value="t" />
					</el-select>
				</el-form-item>
				<el-form-item label="目标年化">
					<div style="display: flex; align-items: center; width: 100%">
						<el-input-number v-model="etfForm.annualReturn" :min="0" :max="50" :precision="1" :step="1" style="width: 160px" />
						<span style="margin-left: 8px">%</span>
						<span style="color: #909399; font-size: 12px; margin-left: 8px">用于走势对比参考</span>
					</div>
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="addDialogVisible = false">取消</el-button>
				<el-button type="primary" @click="handleSave" :loading="saving">{{ isEditing ? '保存' : '添加' }}</el-button>
			</template>
		</el-dialog>

		<el-dialog v-model="syncHistoryDialogVisible" title="同步历史数据" width="550px">
			<el-form label-width="120px">
				<el-form-item label="起始日期">
					<el-date-picker v-model="syncForm.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" style="width: 100%" />
				</el-form-item>
				<el-form-item label="选择ETF">
					<el-select v-model="syncForm.codes" multiple collapse-tags placeholder="请选择ETF（不选则同步全部）" style="width: 100%">
						<el-option v-for="item in etfList" :key="item.code" :label="item.code + ' - ' + item.name" :value="item.code" />
					</el-select>
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="syncHistoryDialogVisible = false">取消</el-button>
				<el-button type="primary" @click="handleSyncHistory" :loading="syncingHistory">开始同步</el-button>
			</template>
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Refresh, DataBoard } from '@element-plus/icons-vue'
import { etfApi, configApi } from '../api'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatDate, formatDateTime } from '@/utils'

const router = useRouter()

const etfList = ref<any[]>([])
const assetTypes = ref(['股票类', '债券类', '红利类', '商品类', '黄金类'])
const addDialogVisible = ref(false)
const isEditing = ref(false)
const saving = ref(false)
const syncing = ref(false)
const syncingHistory = ref(false)
const syncHistoryDialogVisible = ref(false)
const syncForm = ref({
	dateRange: ['2010-01-01', '2026-12-31'],
	codes: [] as string[],
})
const formRef = ref<any>(null)

const etfForm = ref({ code: '', name: '', assetType: '', annualReturn: null })

const rules = {
	code: [{ required: true, message: '请输入ETF代码', trigger: 'blur' }],
	name: [{ required: true, message: '请输入ETF名称', trigger: 'blur' }],
	assetType: [{ required: true, message: '请选择资产类型', trigger: 'change' }],
}

const loadEtfs = async () => {
	try {
		const res: any = await etfApi.list()
		const raw = res.data || []
		etfList.value = raw.map((item: any) => ({
			...item,
			current_price: Number(item.current_price),
			change_pct: Number(item.change_pct),
		}))
		await loadRatios()
	} catch (e: any) {
		ElMessage.error('加载ETF列表失败: ' + e.message)
	}
}

const loadAssetTypes = async () => {
	try {
		const res: any = await configApi.getEtfTypes()
		if (res.data) assetTypes.value = res.data
	} catch {}
}

const showAddDialog = () => {
	isEditing.value = false
	etfForm.value = { code: '', name: '', assetType: '', annualReturn: null }
	addDialogVisible.value = true
}

const showEditDialog = (row: any) => {
	isEditing.value = true
	etfForm.value = {
		code: row.code,
		name: row.name,
		assetType: row.asset_type,
		annualReturn: row.annual_return,
	}
	addDialogVisible.value = true
}

const handleSave = async () => {
	const valid = await formRef.value?.validate().catch(() => false)
	if (!valid) return
	saving.value = true
	try {
		if (isEditing.value) {
			await etfApi.update(etfForm.value)
			ElMessage.success('修改成功')
		} else {
			await etfApi.add(etfForm.value)
			ElMessage.success('添加成功')
		}
		addDialogVisible.value = false
		await loadEtfs()
	} catch (e: any) {
		ElMessage.error(e.message)
	} finally {
		saving.value = false
	}
}

const handleDelete = async (row: any) => {
	try {
		await ElMessageBox.confirm(`确定删除ETF ${row.code} ${row.name}？`, '确认删除', { type: 'warning' })
		await etfApi.delete(row.code)
		ElMessage.success('删除成功')
		await loadEtfs()
	} catch (e: any) {
		if (e !== 'cancel') ElMessage.error(e.message)
	}
}

const syncPrices = async () => {
	syncing.value = true
	try {
		const res: any = await etfApi.syncAll()
		ElMessage.success(res.message || '同步完成')
		await loadEtfs()
	} catch (e: any) {
		ElMessage.error('同步失败: ' + e.message)
	} finally {
		syncing.value = false
	}
}

const showSyncHistoryDialog = () => {
	syncForm.value.dateRange = ['2010-01-01', '2026-12-31']
	syncForm.value.codes = []
	syncHistoryDialogVisible.value = true
}

const handleSyncHistory = async () => {
	if (!syncForm.value.dateRange || syncForm.value.dateRange.length !== 2) {
		ElMessage.warning('请选择起止日期')
		return
	}
	syncingHistory.value = true
	try {
		const [startDate, endDate] = syncForm.value.dateRange
		const res: any = await etfApi.syncHistory(startDate, endDate, syncForm.value.codes)
		ElMessage.success(res.message || '历史数据同步完成')
		syncHistoryDialogVisible.value = false
	} catch (e: any) {
		ElMessage.error('同步历史数据失败: ' + e.message)
	} finally {
		syncingHistory.value = false
	}
}

const goToHistory = (row: any) => {
	router.push({
		path: '/etf-history',
		query: { code: row.code, name: row.name },
	})
}



const assetTypeTag = (type: string): 'primary' | 'success' | 'warning' | 'info' | 'danger' | undefined => {
	const map: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'danger'> = {
		股票类: 'danger',
		债券类: 'success',
		红利类: 'warning',
		商品类: 'info',
		黄金类: 'warning',
	}
	return map[type] || undefined
}

// 初始比例配置合并逻辑
const ratioList = ref<any[]>([])
const savingRatios = ref(false)

const totalRatioSum = computed(() => {
	return ratioList.value
		.filter((r: any) => r.isEnabled !== false)
		.reduce((sum: number, r: any) => sum + parseFloat(r.ratio || 0), 0)
})

const loadRatios = async () => {
	try {
		const ratioRes = await configApi.getInitialRatios()
		const savedRatios = (ratioRes as any).data || []
		ratioList.value = etfList.value.map((etf: any) => {
			const saved = savedRatios.find((r: any) => r.etfCode === etf.code)
			return {
				etf_code: etf.code,
				name: etf.name,
				asset_type: etf.asset_type,
				ratio: saved ? parseFloat(saved.ratio) : 0,
				isEnabled: saved ? saved.isEnabled !== false : true,
				stepRatio: saved ? parseFloat(saved.stepRatio || 5.0) : 5.0,
			}
		})
	} catch (e: any) {
		ElMessage.error('加载初始比例配置失败: ' + e.message)
	}
}

const setMax = (row: any) => {
	if (!row.isEnabled) return
	const currentSum = totalRatioSum.value
	const remaining = 100 - currentSum
	if (remaining > 0) {
		row.ratio = Math.round((parseFloat(row.ratio || 0) + remaining) * 100) / 100
	}
}

const saveRatios = async () => {
	savingRatios.value = true
	try {
		const ratios = ratioList.value.map((r) => ({
			etfCode: r.etf_code,
			ratio: r.isEnabled ? parseFloat(r.ratio || 0) : 0,
			isEnabled: r.isEnabled !== false,
			stepRatio: parseFloat(r.stepRatio || 5.0),
		}))
		await configApi.updateInitialRatios(ratios)
		ElMessage.success('配置保存成功')
	} catch (e: any) {
		ElMessage.error('保存失败: ' + e.message)
	} finally {
		savingRatios.value = false
	}
}

onMounted(() => {
	loadEtfs()
	loadAssetTypes()
})
</script>

<style scoped></style>
