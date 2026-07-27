export class ToastManager {
    constructor() {
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        const icon = document.createElement('div');
        icon.className = 'toast-icon';
        icon.textContent = icons[type] || icons.info;

        const msg = document.createElement('div');
        msg.className = 'toast-message';
        msg.textContent = String(message ?? '');

        const progress = document.createElement('div');
        progress.className = 'toast-progress';
        const bar = document.createElement('div');
        bar.className = 'toast-progress-bar';
        bar.style.animationDuration = `${duration}ms`;
        progress.appendChild(bar);

        toast.appendChild(icon);
        toast.appendChild(msg);
        toast.appendChild(progress);

        this.container.appendChild(toast);
        
        // Trigger entrance animation
        requestAnimationFrame(() => {
            toast.classList.add('toast-show');
        });
        
        // Auto dismiss
        setTimeout(() => {
            toast.classList.remove('toast-show');
            toast.classList.add('toast-hide');
            setTimeout(() => {
                if (toast.parentElement) toast.parentElement.removeChild(toast);
            }, 400);
        }, duration);
        
        return toast;
    }

    success(msg, duration) { return this.show(msg, 'success', duration); }
    error(msg, duration)   { return this.show(msg, 'error', duration); }
    warning(msg, duration) { return this.show(msg, 'warning', duration); }
    info(msg, duration)    { return this.show(msg, 'info', duration); }
}
