import { createElement } from 'react';
import type { ComponentPropsWithRef, ElementType } from 'react';

export function semanticPart<Tag extends ElementType>(tag: Tag, className: string) {
  return function SemanticPart(props: Omit<ComponentPropsWithRef<Tag>, 'className'>) {
    return createElement(tag, { ...props, className });
  };
}
