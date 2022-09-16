import type { ComputedRef, Ref } from 'vue'
import type { Api, ColumnType, KanbanType, TableType, ViewType } from 'nocodb-sdk'
import { useI18n } from 'vue-i18n'
import { message } from 'ant-design-vue'
import type { Row } from '~/composables/useViewData'
import { enumColor } from '~/utils'
import { useNuxtApp } from '#app'

export function useKanbanViewData(
  meta: Ref<TableType> | ComputedRef<TableType> | undefined,
  viewMeta: Ref<ViewType & { id: string }> | ComputedRef<ViewType & { id: string }> | undefined,
) {
  const { t } = useI18n()
  const isPublic = inject(IsPublicInj, ref(false))
  const { api } = useApi()
  const { project } = useProject()
  const { $api } = useNuxtApp()
  const { sorts, nestedFilters } = useSmartsheetStoreOrThrow()
  const { isUIAllowed } = useUIPermission()
  const groupingFieldColOptions = useState<Record<string, any>[]>('KanbanGroupingFieldColOptions', () => [])
  const kanbanMetaData = useState<KanbanType>('KanbanMetaData', () => ({}))
  // formattedData structure
  // {
  //   [val1] : [
  //     {row: {...}, oldRow: {...}, rowMeta: {...}},
  //     {row: {...}, oldRow: {...}, rowMeta: {...}},
  //     ...
  //   ],
  //   [val2] : [
  //     {row: {...}, oldRow: {...}, rowMeta: {...}},
  //     {row: {...}, oldRow: {...}, rowMeta: {...}},
  //     ...
  //   ],
  // }
  const formattedData = useState<Record<string, Row[]>>('KanbanFormattedData', () => ({}))
  const countByStack = useState<Record<string, number>>('KanbanCountByStack', () => ({}))
  const groupingField = useState<string>('KanbanGroupingField', () => '')
  const groupingFieldColumn = useState<Record<string, any>>('KanbanGroupingFieldColumn', () => ({}))
  const stackMetaObj = ref<Record<string, any>>({})

  const formatData = (list: Record<string, any>[]) =>
    list.map((row) => ({
      row: { ...row },
      oldRow: { ...row },
      rowMeta: {},
    }))

  async function loadKanbanData() {
    if ((!project?.value?.id || !meta?.value?.id || !viewMeta?.value?.id) && !isPublic.value) return

    // reset formattedData & countByStack to avoid storing previous data after changing grouping field
    formattedData.value = {}
    countByStack.value = {}

    await Promise.all(
      groupingFieldColOptions.value.map(async (option) => {
        const where =
          option.title === 'Uncategorized' ? `(${groupingField.value},is,null)` : `(${groupingField.value},eq,${option.title})`

        const response = await api.dbViewRow.list('noco', project.value.id!, meta!.value.id!, viewMeta!.value.id, {
          where,
        })

        formattedData.value[option.title] = formatData(response.list)
        countByStack.value[option.title] = response.pageInfo.totalRows || 0
      }),
    )
  }

  async function loadMoreKanbanData(stackTitle: string, params: Parameters<Api<any>['dbViewRow']['list']>[4] = {}) {
    let where = `(${groupingField.value},eq,${stackTitle})`
    if (stackTitle === 'Uncategorized') {
      where = `(${groupingField.value},is,null)`
    }
    const response = await api.dbViewRow.list('noco', project.value.id!, meta!.value.id!, viewMeta!.value.id, {
      ...params,
      ...(isUIAllowed('sortSync') ? {} : { sortArrJson: JSON.stringify(sorts.value) }),
      ...(isUIAllowed('filterSync') ? {} : { filterArrJson: JSON.stringify(nestedFilters.value) }),
      where,
    })
    formattedData.value[stackTitle] = [...formattedData.value[stackTitle], ...formatData(response.list)]
  }

  async function loadKanbanMeta() {
    if (!viewMeta?.value?.id) return
    kanbanMetaData.value = await $api.dbView.kanbanRead(viewMeta.value.id)
    // set groupingField
    groupingFieldColumn.value = meta?.value?.columns?.filter((f) => f.id === kanbanMetaData.value.grp_column_id)[0] || {}
    groupingField.value = groupingFieldColumn.value?.title as string

    const { grp_column_id, stack_meta } = kanbanMetaData.value

    stackMetaObj.value = stack_meta ? JSON.parse(stack_meta as string) : {}

    if (
      stackMetaObj.value &&
      grp_column_id &&
      stackMetaObj.value[grp_column_id] &&
      groupingFieldColumn.value?.colOptions?.options
    ) {
      // keep the existing order (index of the array) but update the values
      for (const option of groupingFieldColumn.value.colOptions.options) {
        const idx = stackMetaObj.value[grp_column_id].findIndex((ele: Record<string, any>) => ele.id === option.id)
        if (idx !== -1) {
          // update the option in stackMetaObj
          stackMetaObj.value[grp_column_id][idx] = {
            ...stackMetaObj.value[grp_column_id][idx],
            ...option,
          }
        } else {
          // new option found
          const len = stackMetaObj.value[grp_column_id].length
          stackMetaObj.value[grp_column_id][len] = {
            ...option,
            collapsed: false,
          }
        }
      }
      // handle deleted options
      const columnOptionIds = groupingFieldColumn.value.colOptions.options.map(({ id }) => id)
      stackMetaObj.value[grp_column_id]
        .filter(({ id }) => id !== 'uncategorized' && !columnOptionIds.includes(id))
        .forEach(({ id }) => {
          const idx = stackMetaObj.value[grp_column_id].map((ele: Record<string, any>) => ele.id).indexOf(id)
          if (idx !== -1) {
            stackMetaObj.value[grp_column_id].splice(idx, 1)
          }
        })
      groupingFieldColOptions.value = stackMetaObj.value[grp_column_id]
    } else {
      // build stack meta
      groupingFieldColOptions.value = [
        ...(groupingFieldColumn.value?.colOptions?.options ?? []),
        // enrich uncategorized stack
        { id: 'uncategorized', title: 'Uncategorized', order: 0, color: enumColor.light[2] },
      ]
        // sort by initial order
        .sort((a: Record<string, any>, b: Record<string, any>) => a.order - b.order)
        // enrich `collapsed`
        .map((ele) => ({
          ...ele,
          collapsed: false,
        }))
    }
    await updateKanbanStackMeta()
  }

  async function updateKanbanStackMeta() {
    const { grp_column_id } = kanbanMetaData.value
    if (grp_column_id) {
      stackMetaObj.value[grp_column_id] = groupingFieldColOptions.value
      await updateKanbanMeta({
        stack_meta: stackMetaObj.value,
      })
    }
  }

  async function updateKanbanMeta(updateObj: Partial<KanbanType>) {
    if (!viewMeta?.value?.id) return
    await $api.dbView.kanbanUpdate(viewMeta.value.id, {
      ...kanbanMetaData.value,
      ...updateObj,
    })
  }

  async function insertRow(row: Record<string, any>, rowIndex = formattedData.value.uncatgorized?.length) {
    try {
      const insertObj = meta?.value?.columns?.reduce((o: any, col) => {
        if (!col.ai && row?.[col.title as string] !== null) {
          o[col.title as string] = row?.[col.title as string]
        }
        return o
      }, {})

      const insertedData = await $api.dbViewRow.create(
        NOCO,
        project?.value.id as string,
        meta?.value.id as string,
        viewMeta?.value?.id as string,
        insertObj,
      )

      formattedData.value.uncatgorized?.splice(rowIndex ?? 0, 1, {
        row: insertedData,
        rowMeta: {},
        oldRow: { ...insertedData },
      })

      return insertedData
    } catch (error: any) {
      message.error(await extractSdkResponseErrorMsg(error))
    }
  }

  async function updateRowProperty(toUpdate: Row, property: string) {
    try {
      const id = extractPkFromRow(toUpdate.row, meta?.value.columns as ColumnType[])

      const updatedRowData = await $api.dbViewRow.update(
        NOCO,
        project?.value.id as string,
        meta?.value.id as string,
        viewMeta?.value?.id as string,
        id,
        {
          [property]: toUpdate.row[property],
        },
        // todo:
        // {
        //   query: { ignoreWebhook: !saved }
        // }
      )
      // audit
      $api.utils
        .auditRowUpdate(id, {
          fk_model_id: meta?.value.id as string,
          column_name: property,
          row_id: id,
          value: getHTMLEncodedText(toUpdate.row[property]),
          prev_value: getHTMLEncodedText(toUpdate.oldRow[property]),
        })
        .then(() => {})

      /** update row data(to sync formula and other related columns) */
      Object.assign(toUpdate.row, updatedRowData)
      Object.assign(toUpdate.oldRow, updatedRowData)
    } catch (e: any) {
      message.error(`${t('msg.error.rowUpdateFailed')} ${await extractSdkResponseErrorMsg(e)}`)
    }
  }

  async function updateOrSaveRow(row: Row) {
    if (row.rowMeta.new) {
      await insertRow(row.row, formattedData.value[row.row.title].indexOf(row))
    } else {
      await updateRowProperty(row, groupingField.value)
    }
  }

  async function deleteStack(stackTitle: string) {
    try {
      // set groupingField to null for all records under the target stack
      await api.dbTableRow.bulkUpdateAll(
        'noco',
        project.value.id!,
        meta!.value.id!,
        {
          [groupingField.value]: null,
        },
        {
          where: `(${groupingField.value},eq,${stackTitle})`,
        },
      )
      // update to groupingField value to null
      formattedData.value[stackTitle] = formattedData.value[stackTitle].map((o) => ({
        ...o,
        row: {
          ...o.row,
          [groupingField.value]: null,
        },
        oldRow: {
          ...o.oldRow,
          [groupingField.value]: null,
        },
      }))
      // merge the 'deleted' stack to Uncategorized stack
      formattedData.value.Uncategorized = [...formattedData.value.Uncategorized, ...formattedData.value[stackTitle]]
      countByStack.value.Uncategorized += countByStack.value[stackTitle]
      // clear the 'deleted' stack
      formattedData.value[stackTitle] = []
      countByStack.value[stackTitle] = 0
    } catch (e: any) {
      message.error(await extractSdkResponseErrorMsg(e))
    }
  }

  function addEmptyRow(addAfter = formattedData.value.Uncategorized?.length) {
    formattedData.value.Uncategorized.splice(addAfter, 0, {
      row: {},
      oldRow: {},
      rowMeta: { new: true },
    })

    return formattedData.value.Uncategorized[addAfter]
  }

  return {
    loadKanbanData,
    loadMoreKanbanData,
    loadKanbanMeta,
    updateKanbanMeta,
    kanbanMetaData,
    formattedData,
    countByStack,
    groupingField,
    groupingFieldColOptions,
    groupingFieldColumn,
    updateOrSaveRow,
    addEmptyRow,
    deleteStack,
    updateKanbanStackMeta,
  }
}