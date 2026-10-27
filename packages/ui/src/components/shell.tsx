import { cn } from '@study/ui/utils';
import { ArrowLeft } from 'lucide-react';
import { cloneElement, isValidElement } from 'react';
import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

type HeaderProps = Omit<ComponentPropsWithRef<'div'>, 'title'> & {
  title: ReactNode;
  parent?: ReactNode;
  parentKind?: 'section' | 'trip';
  backLabel?: string;
  actions?: ReactNode;
  lead?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  tabs?: ReactNode;
  notice?: ReactNode;
  titleProps?: ComponentPropsWithRef<'h1'>;
};

function Header({
  title,
  parent,
  parentKind = 'section',
  backLabel,
  actions,
  lead,
  meta,
  status,
  tabs,
  notice,
  titleProps,
  className,
  children,
  ...props
}: HeaderProps) {
  const back =
    parentKind === 'section' && backLabel && isValidElement(parent)
      ? cloneElement(parent as ReactElement<ComponentPropsWithRef<'a'>>, {
          'aria-label': backLabel,
          className: cn(
            'groam-shell-header-back',
            (parent.props as { className?: string }).className
          ),
          children: <ArrowLeft aria-hidden="true" />
        })
      : null;

  return (
    <div {...props} className={cn('groam-shell-header', className)} data-slot="shell-header">
      <div className="groam-shell-header-padding">
        <div className="groam-shell-header-row">
          <div className="groam-shell-header-heading">
            {back}
            {parent && (
              <>
                <span
                  className="groam-shell-header-parent"
                  data-kind={parentKind}
                  data-slot="shell-header-parent"
                >
                  {parent}
                </span>
                <span className="groam-shell-header-slash" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <Title
              {...titleProps}
              className={cn('groam-shell-header-title', titleProps?.className)}
              title={typeof title === 'string' ? title : undefined}
            >
              {title}
            </Title>
            {status && (
              <span className="groam-shell-header-status" data-slot="shell-header-status">
                {status}
              </span>
            )}
          </div>
          {(actions || lead) && (
            <div className="groam-shell-header-controls">
              {lead && <div className="groam-shell-header-lead">{lead}</div>}
              {lead && actions && (
                <span className="groam-shell-header-divider" aria-hidden="true" />
              )}
              {actions && (
                <div className="groam-shell-header-actions" data-slot="shell-header-actions">
                  {actions}
                </div>
              )}
            </div>
          )}
        </div>
        {meta && (
          <div className="groam-shell-header-meta" data-slot="shell-header-meta">
            <div className="groam-shell-header-meta-clip">
              <div className="groam-shell-header-meta-row">
                {typeof meta === 'string' ? (
                  <span className="groam-shell-header-fact">{meta}</span>
                ) : (
                  meta
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {tabs}
      {notice}
      {children}
    </div>
  );
}

function Title({
  children,
  className,
  hideOnMobile = false,
  ...props
}: ComponentPropsWithRef<'h1'> & { hideOnMobile?: boolean }) {
  return (
    <h1
      {...props}
      className={cn(
        'groam-shell-title',
        hideOnMobile && 'groam-shell-title-hide-mobile',
        className
      )}
      data-slot="shell-title"
    >
      {children}
    </h1>
  );
}

function PageBody({
  layout = 'padded',
  clearNav = false,
  className,
  ...props
}: ComponentPropsWithRef<'div'> & {
  layout?: 'padded' | 'bleed';
  clearNav?: boolean;
}) {
  return (
    <div
      {...props}
      className={cn('groam-shell-page-body', className)}
      data-layout={layout}
      data-clear-nav={clearNav || undefined}
      data-slot="shell-page-body"
    />
  );
}

function SectionHeader({
  title,
  description,
  trailing,
  density = 'default',
  className,
  ...props
}: Omit<ComponentPropsWithRef<'header'>, 'title'> & {
  title?: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  density?: 'compact' | 'default';
}) {
  return (
    <header
      {...props}
      className={cn('groam-shell-section-header', className)}
      data-density={density}
      data-slot="shell-section-header"
    >
      <div className="groam-shell-section-heading">
        <div className="groam-shell-section-copy">
          {title && <h2 className="groam-shell-section-title">{title}</h2>}
          {description && <p className="groam-shell-section-description">{description}</p>}
        </div>
        {trailing && <div className="groam-shell-section-trailing">{trailing}</div>}
      </div>
    </header>
  );
}

export const Shell = Object.assign(Header, {
  Header,
  PageBody,
  SectionHeader,
  Title
});

export { Header, PageBody, SectionHeader, Title };
export type { HeaderProps };
