import { createFileRoute, notFound } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { DocMarkdown } from '~/components/docs/DocMarkdown'
import { getDocPage } from '~/lib/produitDocs'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'

export const Route = createFileRoute('/app/$orgSlug/docs/$page')({
  // The pages are a build-time constant, so an unknown slug is knowable
  // before rendering — a stale bookmark gets a 404, not an empty page.
  beforeLoad: ({ params }) => {
    if (!getDocPage(params.page)) throw notFound()
  },
  component: DocPageView,
  notFoundComponent: DocPageNotFound,
  head: ({ params }) => {
    const t = getI18n(getLocale()).getFixedT(null, 'nav')
    const page = getDocPage(params.page)
    return {
      meta: [
        {
          title: page
            ? t('docsPage.metaTitlePage', { title: page.title })
            : t('docsPage.metaTitle'),
        },
      ],
    }
  },
})

function DocPageView() {
  const { orgSlug, page } = Route.useParams()
  const doc = getDocPage(page)
  if (!doc) return <DocPageNotFound />
  return <DocMarkdown markdown={doc.markdown} orgSlug={orgSlug} />
}

function DocPageNotFound() {
  const { t } = useTranslation('nav')
  return <p className="text-muted-foreground text-sm">{t('docsPage.notFound')}</p>
}
