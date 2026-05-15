import { WidgetType } from '@codemirror/view';

export class HeadingNumberWidget extends WidgetType {
    constructor(private readonly number: string) {
        super();
    }

    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'pem-heading-number';
        span.textContent = this.number + ' ';
        return span;
    }

    eq(other: HeadingNumberWidget): boolean {
        return other.number === this.number;
    }
}
