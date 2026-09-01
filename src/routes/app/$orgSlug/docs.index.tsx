import { createFileRoute } from '@tanstack/react-router'

import { DocMarkdown } from '~/components/docs/DocMarkdown'
import { docsSummary } from '~/lib/produitDocs'
import { getI18n } from '~/lib/i18n'
import { getLocale } from '~/lib/locale'

export const Route = createFileRoute('/app/$orgSlug/docs/')({
  component: DocsSummaryPage,
  head: () => ({
    meta: [
      {
        title: getI18n(getLocale()).getFixedT(null, 'nav')('docsPage.metaTitle'),
      },
    ],
  }),
})

/** The folder's `README.md` — the grouped table of contents. */
function DocsSummaryPage() {
  const { orgSlug } = Route.useParams()
  return <DocMarkdown markdown={docsSummary.markdown} orgSlug={orgSlug} />
}
