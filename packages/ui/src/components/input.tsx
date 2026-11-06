import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from '@study/ui/utils';
import type * as React from 'react';

import { CONTROL_SURFACE_CLASS } from './control-styles';

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, 'size'> & {
  size?: 'sm' | 'compact' | 'default' | 'lg' | number;
  font?: 'default' | 'mono';
  unstyled?: boolean;
  nativeInput?: boolean;
};

function inputClasses(size: InputProps['size'], type: InputProps['type']) {
  return cn(
    'h-8.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-placeholder sm:h-7.5 sm:leading-7.5 [transition:background-color_5000000s_ease-in-out_0s]',
    size === 'compact' && 'h-7 px-[calc(--spacing(2.5)-1px)] text-xs leading-7 sm:h-7 sm:leading-7',
    size === 'sm' && 'h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5',
    size === 'lg' && 'h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5',
    type === 'search' &&
      '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none',
    type === 'number' &&
      '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    type === 'file' &&
      'text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm'
  );
}

function Input({
  className,
  size = 'default',
  font = 'default',
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = inputClasses(size, props.type);

  return (
    <span
      className={
        cn(
          !unstyled &&
            cn(
              CONTROL_SURFACE_CLASS,
              'has-autofill:bg-foreground/4 dark:has-autofill:bg-foreground/8'
            ),
          !unstyled && size === 'compact' && 'rounded-md',
          font === 'mono' && 'font-mono tabular-nums',
          className
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      <InputElement {...props} className={inputClassName} size={size} nativeInput={nativeInput} />
    </span>
  );
}

function InputElement({
  nativeInput,
  size,
  className: inputClassName,
  ...props
}: Omit<InputProps, 'className'> & { className: string }) {
  if (nativeInput) {
    const { style, onValueChange: _onValueChange, ...nativeInputProps } = props;
    const nativeStyle = typeof style === 'function' ? undefined : style;

    return (
      <input
        className={inputClassName}
        data-slot="input"
        size={typeof size === 'number' ? size : undefined}
        style={nativeStyle}
        {...(nativeInputProps as React.ComponentProps<'input'>)}
      />
    );
  } else {
    return (
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        size={typeof size === 'number' ? size : undefined}
        {...props}
      />
    );
  }
}

export { Input, type InputProps };
