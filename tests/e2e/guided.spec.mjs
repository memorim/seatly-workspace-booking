import {test,expect} from '@playwright/test';
test('guided synthetic booking completes both roles, rescheduling and cancellation',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Пройти демонстрацию',exact:true}).click();const d=page.getByRole('dialog');
 for(const name of ['Создать учебную заявку','Подтвердить как владелец','Перенести на следующий день','Отменить учебную заявку'])await d.getByRole('button',{name,exact:true}).click();
 await expect(d.getByRole('heading',{name:'Сценарий завершён',exact:true})).toBeVisible();await d.getByRole('button',{name:'Посмотреть учебную заявку',exact:true}).click();await expect(page.getByRole('dialog').locator('.booking-record').getByText('Отменено',{exact:true})).toBeVisible();
});
