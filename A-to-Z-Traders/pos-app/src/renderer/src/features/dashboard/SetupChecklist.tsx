import clsx from 'clsx'
import type { JSX } from 'react'
import { Link } from 'react-router-dom'
import type { DatabaseInfo, Settings } from '@shared/types'
import { Card, CardBody, CardHeader } from '../../components/ui/Surface'
import { Icon } from '../../components/icons/Icon'

interface SetupChecklistProps {
  settings: Settings
  info: DatabaseInfo | null
}

/**
 * Shown only while the shop is still being set up.
 *
 * A brand-new POS with empty charts tells the owner nothing; a short ordered
 * list of what to do next does. The card disappears on its own once every
 * step is done — the numbering is real here because the steps genuinely
 * depend on each other: you cannot bill what you have not stocked.
 */
export function SetupChecklist({ settings, info }: SetupChecklistProps): JSX.Element | null {
  const steps = [
    {
      done: settings.businessName.trim().length > 0,
      title: 'Add your business details',
      hint: 'The name, address and phone that print on every bill.',
      to: '/settings'
    },
    {
      done: (info?.counts.products ?? 0) > 0,
      title: 'Add your products',
      hint: 'Set the unit each item is counted in, its cost and its sale price.',
      to: '/products'
    },
    {
      done: (info?.counts.purchases ?? 0) > 0 || (info?.counts.products ?? 0) > 0,
      title: 'Bring stock in',
      hint: 'Record a purchase, or set opening stock on each product.',
      to: '/purchases/new'
    },
    {
      done: (info?.counts.customers ?? 0) > 0,
      title: 'Add your regular customers',
      hint: 'Needed for khata sales and statements. Walk-in cash sales do not need one.',
      to: '/customers'
    },
    {
      done: settings.autoBackupDir.trim().length > 0,
      title: 'Turn on automatic backups',
      hint: 'Choose a folder — ideally a USB drive — and the app copies your data there on close.',
      to: '/settings'
    }
  ]

  if (steps.every((step) => step.done)) return null

  const remaining = steps.filter((step) => !step.done).length

  return (
    <Card>
      <CardHeader
        title="Finish setting up"
        subtitle={`${remaining} step${remaining === 1 ? '' : 's'} left`}
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <div key={step.title} className="flex items-start gap-3">
              <span
                className={clsx(
                  'grid size-[22px] shrink-0 place-items-center rounded-full border text-micro font-bold',
                  step.done
                    ? 'border-good-border bg-good-weak text-good'
                    : 'border-accent-border bg-accent-weak text-accent-ink'
                )}
              >
                {step.done ? <Icon name="check" size={12} /> : index + 1}
              </span>
              <span className="flex flex-col gap-[2px]">
                {step.done ? (
                  <span className="text-sm font-medium">{step.title}</span>
                ) : (
                  <Link to={step.to} className="text-sm font-medium">
                    {step.title}
                  </Link>
                )}
                <span className="text-caption text-ink-muted">{step.hint}</span>
              </span>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
