# 2 장순환 

**==> picture [720 x 70] intentionally omitted <==**

**==> picture [42 x 72] intentionally omitted <==**

## ? 순환 이란 (recursion) 

- 알고리즘이나함수가수행도중에자기자신을다시호출하여문제 를해결하는기법 

- 정의자체가순환적으로되어있는경우에적합한방법 

**==> picture [183 x 174] intentionally omitted <==**

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## #1 팩토리얼프로그래밍 

##  팩토리얼의정의 

= 1 _n_ 0  _n_ ! =  * − _n n_ 1 _n_  1  ( )! 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## #1 팩토리얼프로그래밍 

**int** factorial( **int** n) { **if** ( n<= 1 ) **return** (1); **else return** (n * factorial_n_1(n-1) ); } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

##  #include <stdio.h> 

 long long factorial(int n) {  long long r; 

 if (n == 0) r = 1; 

 else 

 r = n * factorial(n - 1); 

return r; 

 } 

- int main() { int i; 

- for (i = 0; i < 15; i++) 

- printf("%2d! = %lld\n", i, factorial(i)); 

- return 0; } 

https://www.mycompiler.io/ko/new/c 

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [75 x 71] intentionally omitted <==**

**==> picture [42 x 72] intentionally omitted <==**

## #2 팩토리얼프로그래밍 

**int** factorial( **int** n) { **if** ( n <= 1 ) **return** (1); **else return** (n * factorial(n-1) ); } 

**==> picture [571 x 196] intentionally omitted <==**

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 순환호출순서 

**==> picture [663 x 328] intentionally omitted <==**

**----- Start of picture text -----**<br>
 팩토리얼함수의호출순서<br>factorial(3)<br>{<br>    if( 3 <= 1 ) return 1;<br>factorial(5) = 5 * factorial(4)  else return (3 * factorial(3-1) ); ①<br>④ }<br>   = 5 * 4 * factorial(3)<br>   = 5 * 4 * 3 * factorial(2) factorial(2)<br>{<br>   = 5 * 4 * 3 * 2 * factorial(1)<br>    if( 2 <= 1 ) return 1;<br>   = 5 * 4 * 3 * 2 * 1 ②<br>else return (2 * factorial(2-1) );<br>③<br>   = 120 }<br>factorial(1)<br>{<br>if( 1 <= 1 ) return 1;<br>.....<br>}<br>**----- End of picture text -----**<br>


**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 순환알고리즘의구조 

`int factorial(int n) { if( n <= 1 )  return 1` 순환을멈추는부분 `else return n * factorial(n-1);` 순환호출을하는부분 `}` 

**==> picture [48 x 113] intentionally omitted <==**

- ⚫ 만약순환호출을멈추는부분이없다면?. 

   - ⚫ 시스템오류가발생할때까지무한정호출하게된다. 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## <-> 순환 반복 

 대부분의순환은반복으로바꾸어작성할수있다. 

**==> picture [562 x 246] intentionally omitted <==**

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 팩토리얼의반복적구현 

= 1 _n_ 1  _n_ ! =  * − * − *  * _n n n_ 2 1 _n_  2  ( )1 ( ) 

**int** factorial_iter( **int** n) { **int** k, v=1; **for** (k=n; k>0; k--) v = v*k; **return** (v); } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## #1 거듭제곱값프로그래밍 

 순환적인방법이더효율적인예제  숫자 x의 n제곱값을구하는문제: x[n] 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 반복적인방법 

**double** slow_power( **double** x, **int** n) { **int** i; **double** result = 1.0; **for** (i=0; i<n; i++) result = result * x; **return** (result); } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 순환적인방법 

##  순환적인알고리즘 

power(x, n) **if** n==0 **then return** 1; **else if** n 이짝수 **then return** power(x[2] , n/2);   //x[n ] = x[2(2/n)] **else if** n 이홀수 **then return** x*power(x[2] , (n-1)/2); 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 순환적인방법 

double power(double x, int n) { if( n==0 ) return 1; else if ( (n%2)==0 ) return power(x*x, n/2); else return x*power(x*x, (n-1)/2); } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 거듭제곱값프로그래밍분석 

##  순환적인방법의시간복잡도 

 만약n이2의제곱이라고가정하면다음과같이문제의크기가 줄어든다. 

**==> picture [274 x 21] intentionally omitted <==**

##  반복적인방법과순환적인방법의비교 

||반복적인함수slow_power|순환적인함수power|
|---|---|---|
|시간복잡도|O(n)|O(logn)|
|실제수행속도|7.17초|0.47초|



**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## #1 피보나치수열의계산 

- 순환호출을사용하면 비효율적인예 

- 피보나치수열 

0,1,1,2,3,5,8,13,21,… 

0 _n_ = 0  = _n_ 1 _n_ 1 _fib_ ( )  − − _n_ 2 + _n otherwise fib_ ( ) _fib_ ( )1  

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## #1 피보나치수열의계산 

**int** fib( **int** n) { **if** ( n==0 ) **return** 0; **if** ( n==1 ) **return** 1; **return** (fib(n-1) + fib(n-2)); } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## #include <stdio.h> 

int Fibonacci(int n) { if (n==0) return 0; else if (n <= 1) return 1; return Fibonacci( n-1) + Fibonacci(n-2); } 

int main(void) { int i,n = 10; for(i=0; i < n; i++) printf("%d\n", Fibonacci(i));return 0; } 

https://www.mycompiler.io/ko/new/c 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

## #1 피보나치수열의계산 

- 순환호출을사용했을경우의비효율성 

   - 같은항이중복해서계산됨 

   - 예를들어fib(6)을호출하게되면fib(3)이4번이나중복되어서계 산됨 

   - 이러한현상은n이커지면더심해짐 

**==> picture [597 x 186] intentionally omitted <==**

**----- Start of picture text -----**<br>
fib(6)<br>fib(4)<br>fib(5)<br>fib(2) fib(3)<br>fib(3) fib(4)<br>fib(2) fib(3)<br>fib(1) fib(2) fib(1) fib(2) fib(2) fib(3)<br>**----- End of picture text -----**<br>


**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

**==> picture [488 x 330] intentionally omitted <==**

**==> picture [75 x 71] intentionally omitted <==**

C로쉽게풀어쓴자료구조 © 생능출판사2019 

**==> picture [42 x 72] intentionally omitted <==**

## 피보나치수열의반복구현 

int fib_iter(int n) { if (n == 0) return 0; if (n == 1) return 1; int pp = 0; int p = 1; int result = 0; for (int i = 2; i <= n; i++) { result = p + pp; pp = p; p = result; } return result; } 

**==> picture [75 x 54] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

##  #include <stdio.h> 

- int main() { 

 int i; 

- long long t1 = 0, t2 = 1, nextTerm; 

- printf("피보나치수열: "); 

 

- for (i = 1; i <= 50; ++i) { 

- printf("%lld\n ", t1); 

- nextTerm = t1 + t2;     t1 = t2;      t2 = nextTerm;    }      return 0; 

 } https://www.mycompiler.io/ko/new/c 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 하노이탑문제 

- 문제는막대 A에쌓여있는원판 n개를막대 C로옮기는 것이다. 

   - 한번에하나의원판만이동할수있다 

   - 맨위에있는원판만이동할수있다 

   - 크기가작은원판위에큰원판이쌓일수없다. 

   - 중간의막대를임시적으로이용할수있으나앞의조건들을 지켜야한다. 

**==> picture [96 x 72] intentionally omitted <==**

**==> picture [96 x 72] intentionally omitted <==**

**==> picture [96 x 72] intentionally omitted <==**

A 

B 

C 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## n=3 인경우의해답 

**==> picture [35 x 8] intentionally omitted <==**

**==> picture [42 x 8] intentionally omitted <==**

**==> picture [582 x 260] intentionally omitted <==**

**----- Start of picture text -----**<br>
A B C<br>A B C<br>A B C<br>A B C<br>A B C<br>A B C<br>A B C<br>A B C<br>**----- End of picture text -----**<br>


**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## ? 일반적인경우에는 

**==> picture [648 x 405] intentionally omitted <==**

**----- Start of picture text -----**<br>
n-1개의원판<br>1개의원판<br>A B C C를임시버퍼로사용하여A에<br>쌓여있는n-1개의원판을B로<br>옮긴다.<br>A B C<br>A의가장큰원판을C로옮긴다.<br>A B C<br>A를임시버퍼로사용하여B에<br>쌓여있는n-1개의원판을C로<br>옮긴다.<br>A B C<br>C로쉽게풀어쓴자료구조 © 생능출판사2019<br>**----- End of picture text -----**<br>


**==> picture [42 x 72] intentionally omitted <==**

## ? 남아있는문제는 

- 자,그러면어떻게 n-1개의원판을 A에서 B로, 또 B에서 C 로이동하는가? 

- **(** 힌트 **)** 우리의원래문제가 **n** 개의원판을 **A** 에서 **C** 로옮기 는 것임을기억하라 **.** 

- -> 따라서지금작성하고있는함수의 매개변수를 n-1로 바꾸어순환호출하면된다. 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## ? 남아있는문제는 

**==> picture [325 x 93] intentionally omitted <==**

// 막대 A에쌓여있는 n개의원판을막대 B를사용하여막대 C로 옮긴다. **void int char char char** hanoi_tower( n, A, B, C) { **if** (n==1){ A에서 C로원판을옮긴다. } **else** { **hanoi_tower(n-1, A, C, B);** A에있는한개의원판을 C로옮긴다. **hanoi_tower(n-1, B, A, C);** } } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 하노이탑최종프로그램 

## # **include** <stdio.h> 

**void** hanoi_tower( **int** n, **char** from, **char** tmp, **char** to) { **if** ( n==1 ) printf("원판 1을 %c 에서 %c으로옮긴다.\n",from,to); **else** { hanoi_tower(n-1, from, to, tmp); printf("원판 %d을 %c에서 %c으로옮긴다.\n",n, from, to); hanoi_tower(n-1, tmp, from, to); } } int main(void) { hanoi_tower(4, 'A', 'B', 'C'); retrun 0; } 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## 실행결과 

원판 1을 A 에서 B으로옮긴다. 원판 2을 A에서 C으로옮긴다. 원판 1을 B 에서 C으로옮긴다. 원판 3을 A에서 B으로옮긴다. 원판 1을 C 에서 A으로옮긴다. 원판 2을 C에서 B으로옮긴다. 원판 1을 A 에서 B으로옮긴다. 원판 4을 A에서 C으로옮긴다. 원판 1을 B 에서 C으로옮긴다. 원판 2을 B에서 A으로옮긴다. 원판 1을 C 에서 A으로옮긴다. 원판 3을 B에서 C으로옮긴다. 원판 1을 A 에서 B으로옮긴다. 원판 2을 A에서 C으로옮긴다. 원판 1을 B 에서 C으로옮긴다. 

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조 

**==> picture [42 x 72] intentionally omitted <==**

## Q & A 

**==> picture [221 x 161] intentionally omitted <==**

**==> picture [135 x 130] intentionally omitted <==**

**==> picture [75 x 71] intentionally omitted <==**

© 생능출판사2019 

C로쉽게풀어쓴자료구조