<template>
  <div class="space-y-4">
    <p class="text-xs text-muted">{{ $t('projectPages.settings.companyUsedBy') }}</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="$t('projectPages.settings.companyName')" :hint="$t('projectPages.settings.companyNameHint')"><UInput v-model="model.name" class="w-full" maxlength="120" /></UFormField>
      <UFormField :label="$t('projectPages.settings.companyLegalName')" :hint="$t('projectPages.settings.companyLegalNameHint')"><UInput v-model="model.legalName" class="w-full" maxlength="120" /></UFormField>
    </div>
    <UFormField :label="$t('projectPages.settings.companyAddress')" :hint="$t('projectPages.settings.companyAddressHint')">
      <UTextarea v-model="model.address" :rows="2" autoresize class="w-full" maxlength="300" />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="$t('projectPages.settings.companyEmail')"><UInput v-model="model.email" type="email" class="w-full" maxlength="200" /></UFormField>
      <UFormField :label="$t('projectPages.settings.companyPhone')"><UInput v-model="model.phone" type="tel" class="w-full" maxlength="40" /></UFormField>
      <UFormField :label="$t('projectPages.settings.companyWebsite')"><UInput v-model="model.website" placeholder="https://" class="w-full" maxlength="300" /></UFormField>
      <UFormField :label="$t('projectPages.settings.companyDpo')" :hint="$t('projectPages.settings.optional')"><UInput v-model="model.dpo" class="w-full" maxlength="200" /></UFormField>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CompanyProfile } from '#shared/company'

// The company profile (shared/company.ts), one form for the project's Settings.
// Legal documents and campaign footers read it; their own screens link here.
const model = defineModel<CompanyProfile>({ required: true })
</script>
