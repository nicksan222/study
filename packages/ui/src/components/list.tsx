import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cn } from '@study/ui/utils';
import type { ComponentPropsWithRef } from 'react';

function Root({
  bleed = true,
  fill = false,
  className,
  ...props
}: ComponentPropsWithRef<'div'> & { bleed?: boolean; fill?: boolean }) {
  return (
    <div
      {...props}
      role="list"
      className={cn('groam-list-root', className)}
      data-bleed={bleed || undefined}
      data-fill={fill || undefined}
      data-slot="list"
    />
  );
}

function Row({
  render,
  className,
  selected = false,
  cursor = false,
  attention = false,
  deferred = false,
  ...props
}: useRender.ComponentProps<'div'> & {
  selected?: boolean;
  cursor?: boolean;
  attention?: boolean;
  deferred?: boolean;
}) {
  const defaultProps = {
    className: cn('groam-list-row', className),
    role: render ? undefined : 'listitem',
    'data-selected': selected || undefined,
    'data-cursor': cursor || undefined,
    'data-attention': attention || undefined,
    'data-deferred': deferred || undefined,
    'data-slot': 'list-row'
  };

  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(defaultProps, props),
    render
  });
}

function Main({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div {...props} className={cn('groam-list-main', className)} data-slot="list-main" />;
}

function Title({
  className,
  muted = false,
  ...props
}: ComponentPropsWithRef<'span'> & { muted?: boolean }) {
  return (
    <span
      {...props}
      className={cn('groam-list-title', className)}
      data-muted={muted || undefined}
      data-slot="list-title"
    />
  );
}

function Description({ className, ...props }: ComponentPropsWithRef<'span'>) {
  return (
    <span
      {...props}
      className={cn('groam-list-description', className)}
      data-slot="list-description"
    />
  );
}

function Leading({ className, ...props }: ComponentPropsWithRef<'span'>) {
  return (
    <span {...props} className={cn('groam-list-leading', className)} data-slot="list-leading" />
  );
}

function Icon({ className, ...props }: ComponentPropsWithRef<'span'>) {
  return <span {...props} className={cn('groam-list-icon', className)} data-slot="list-icon" />;
}

function Meta({ className, ...props }: ComponentPropsWithRef<'span'>) {
  return <span {...props} className={cn('groam-list-meta', className)} data-slot="list-meta" />;
}

function Footer({
  className,
  clearDock = false,
  desktopOnly = false,
  ...props
}: ComponentPropsWithRef<'footer'> & {
  clearDock?: boolean;
  desktopOnly?: boolean;
}) {
  return (
    <footer
      {...props}
      className={cn('groam-list-footer', className)}
      data-clear-dock={clearDock || undefined}
      data-desktop-only={desktopOnly || undefined}
      data-slot="list-footer"
    />
  );
}

export const List = Object.assign(Root, {
  Root,
  Row,
  Main,
  Title,
  Description,
  Leading,
  Icon,
  Meta,
  Footer
});
