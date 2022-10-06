<script lang="ts" setup>
import { useTitle } from '@vueuse/core'
import { definePageMeta, useI18n, useRoute } from '#imports'

definePageMeta({
  pageTransition: {
    name: 'slide-left',
    mode: 'out-in',
  },
})

const route = useRoute()

const { te, t } = useI18n()

console.log('auth')

useTitle(route.meta?.title && te(route.meta.title) ? `${t(route.meta.title)} | NocoDB` : 'NocoDB')
</script>

<script lang="ts">
export default {
  name: 'AuthLayout',
}
</script>

<template>
  <div class="h-full w-full">
    <a-layout-content>
      <div class="md:bg-primary bg-opacity-5 h-full min-h-[600px] flex flex-col justify-center items-center">
        <slot />
      </div>
    </a-layout-content>
  </div>
</template>
